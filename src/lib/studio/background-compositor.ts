"use client";

import type { ImageSegmenter, ImageSegmenterResult } from "@mediapipe/tasks-vision";
import { BACKGROUNDS, coverRect, maskToAlpha, type SceneId } from "./backgrounds";

/**
 * In-browser virtual background. MediaPipe's selfie segmenter finds the person
 * in each camera frame; the scene is drawn behind them on a canvas. Everything
 * runs on the device: frames never leave the browser.
 *
 * Two outputs are kept in sync:
 * - `outputTrack`: unmirrored canvas stream, recorded for local replay.
 * - preview canvas: the person mirrored (like a mirror) over an unmirrored scene,
 *   so any writing in the scene stays readable.
 */

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/selfie_segmenter.tflite";
/** Segmentation runs on a downscaled copy of the frame; the mask is upscaled with smoothing. */
const SEG_WIDTH = 320;
const FPS = 30;
const FRAME_INTERVAL_MS = 1000 / FPS - 2;
/** Consecutive segmentation errors before switching to plain camera passthrough. */
const MAX_FAILURES = 15;

let segmenterPromise: Promise<ImageSegmenter> | null = null;

async function createSegmenter(): Promise<ImageSegmenter> {
  const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(new URL(WASM_PATH, window.location.origin).href);
  const make = (delegate: "GPU" | "CPU") =>
    ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL(MODEL_PATH, window.location.origin).href, delegate },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  try {
    return await make("GPU");
  } catch {
    return await make("CPU");
  }
}

/** One shared segmenter per page; a failed load can be retried. */
function loadSegmenter(): Promise<ImageSegmenter> {
  segmenterPromise ??= createSegmenter().catch((err: unknown) => {
    segmenterPromise = null;
    throw err;
  });
  return segmenterPromise;
}

const sceneCache = new Map<SceneId, Promise<HTMLImageElement>>();

function loadScene(id: SceneId): Promise<HTMLImageElement> {
  let p = sceneCache.get(id);
  if (!p) {
    const src = BACKGROUNDS[id].src;
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      if (!src) return reject(new Error(`No image for ${id}`));
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Couldn't load the ${id} background`));
      img.src = src;
    }).catch((err: unknown) => {
      sceneCache.delete(id);
      throw err;
    });
    sceneCache.set(id, p);
  }
  return p;
}

function canvas2d(w = 1, h = 1): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D isn't available");
  return [c, ctx];
}

export class BackgroundCompositor {
  private readonly video: HTMLVideoElement;
  private readonly out: HTMLCanvasElement;
  private readonly outCtx: CanvasRenderingContext2D;
  private readonly person: HTMLCanvasElement;
  private readonly personCtx: CanvasRenderingContext2D;
  private readonly bg: HTMLCanvasElement;
  private readonly bgCtx: CanvasRenderingContext2D;
  private readonly seg: HTMLCanvasElement;
  private readonly segCtx: CanvasRenderingContext2D;
  private readonly mask: HTMLCanvasElement;
  private readonly maskCtx: CanvasRenderingContext2D;

  private preview: HTMLCanvasElement | null = null;
  private previewCtx: CanvasRenderingContext2D | null = null;
  private segmenter: ImageSegmenter | null = null;
  private scene: HTMLImageElement | null = null;
  private sourceTrackId: string | null = null;
  private track: MediaStreamTrack | null = null;
  private maskData: ImageData | null = null;
  private prevConf: Float32Array | null = null;
  private personConf: Float32Array | null = null;
  private hasMask = false;
  private raf = 0;
  private lastFrameAt = 0;
  private lastTs = 0;
  private failures = 0;
  private passthrough = false;
  private stopped = false;

  constructor(private readonly onFatal?: (err: unknown) => void) {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    [this.out, this.outCtx] = canvas2d(1280, 720);
    [this.person, this.personCtx] = canvas2d(1280, 720);
    [this.bg, this.bgCtx] = canvas2d(1280, 720);
    [this.seg, this.segCtx] = canvas2d(SEG_WIDTH, 180);
    [this.mask, this.maskCtx] = canvas2d(SEG_WIDTH, 180);
  }

  /**
   * Loads the model and scene, attaches the camera, and returns the composited
   * video track. Safe to call again to switch scene or camera.
   */
  async start(source: MediaStream, sceneId: SceneId): Promise<MediaStreamTrack> {
    this.stopped = false;
    const [segmenter, scene] = await Promise.all([loadSegmenter(), loadScene(sceneId)]);
    if (this.stopped) throw new Error("stopped");
    this.segmenter = segmenter;
    this.scene = scene;
    this.passthrough = false;
    this.failures = 0;
    this.paintBackground();
    this.setSource(source);
    if (!this.track || this.track.readyState === "ended") {
      const stream = this.out.captureStream(FPS);
      this.track = stream.getVideoTracks()[0] ?? null;
      if (!this.track) throw new Error("Canvas capture isn't supported");
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
    return this.track;
  }

  setPreview(el: HTMLCanvasElement | null): void {
    this.preview = el;
    this.previewCtx = el ? el.getContext("2d") : null;
  }

  stop(): void {
    this.stopped = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.track?.stop();
    this.track = null;
    this.video.pause();
    this.video.srcObject = null;
    this.sourceTrackId = null;
    this.prevConf = null;
    this.hasMask = false;
  }

  private setSource(source: MediaStream): void {
    const vt = source.getVideoTracks()[0];
    if (!vt) throw new Error("No camera track");
    if (vt.id === this.sourceTrackId) return;
    this.sourceTrackId = vt.id;
    this.prevConf = null;
    this.hasMask = false;
    this.video.srcObject = new MediaStream([vt]);
    void this.video.play().catch(() => undefined);
  }

  private resize(w: number, h: number): void {
    if (this.out.width === w && this.out.height === h) return;
    for (const c of [this.out, this.person, this.bg]) {
      c.width = w;
      c.height = h;
    }
    const sh = Math.max(1, Math.round((SEG_WIDTH * h) / w));
    this.seg.width = SEG_WIDTH;
    this.seg.height = sh;
    this.paintBackground();
  }

  private paintBackground(): void {
    if (!this.scene) return;
    const { width: w, height: h } = this.bg;
    const r = coverRect(this.scene.naturalWidth || 1280, this.scene.naturalHeight || 720, w, h);
    this.bgCtx.clearRect(0, 0, w, h);
    this.bgCtx.drawImage(this.scene, r.x, r.y, r.w, r.h);
  }

  private readonly tick = (now: number): void => {
    if (this.stopped) return;
    this.raf = requestAnimationFrame(this.tick);
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth || now - this.lastFrameAt < FRAME_INTERVAL_MS) return;
    this.lastFrameAt = now;
    this.resize(v.videoWidth, v.videoHeight);
    if (!this.passthrough) this.segment();
    this.composite();
  };

  private segment(): void {
    const segmenter = this.segmenter;
    if (!segmenter) return;
    this.segCtx.drawImage(this.video, 0, 0, this.seg.width, this.seg.height);
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    try {
      segmenter.segmentForVideo(this.seg, ts, (result) => this.readMask(result));
      this.failures = 0;
    } catch (err) {
      this.failures += 1;
      if (this.failures >= MAX_FAILURES) {
        // Keep the recording usable: show the plain camera instead of a frozen frame.
        this.passthrough = true;
        this.onFatal?.(err);
      }
    }
  }

  private readMask(result: ImageSegmenterResult): void {
    const masks = result.confidenceMasks;
    if (!masks?.length) return;
    const m = masks[0];
    const conf = m.getAsFloat32Array();
    const n = m.width * m.height;
    if (this.mask.width !== m.width || this.mask.height !== m.height || !this.maskData) {
      this.mask.width = m.width;
      this.mask.height = m.height;
      this.maskData = this.maskCtx.createImageData(m.width, m.height);
      this.prevConf = null;
    }
    // selfie_segmenter has one "person" channel; multiclass models put background at index 0.
    let person = conf;
    if (masks.length > 1) {
      if (!this.personConf || this.personConf.length !== n) this.personConf = new Float32Array(n);
      for (let i = 0; i < n; i++) this.personConf[i] = 1 - conf[i];
      person = this.personConf;
    }
    if (!this.prevConf || this.prevConf.length !== n) this.prevConf = Float32Array.from(person);
    maskToAlpha(person, this.prevConf, this.maskData.data);
    this.maskCtx.putImageData(this.maskData, 0, 0);
    this.hasMask = true;
  }

  private composite(): void {
    const { width: w, height: h } = this.out;
    const pc = this.personCtx;
    pc.globalCompositeOperation = "copy";
    pc.drawImage(this.video, 0, 0, w, h);
    if (!this.passthrough) {
      pc.globalCompositeOperation = "destination-in";
      pc.imageSmoothingEnabled = true;
      pc.imageSmoothingQuality = "high";
      if (this.hasMask) pc.drawImage(this.mask, 0, 0, w, h);
      else pc.clearRect(0, 0, w, h);
    }
    pc.globalCompositeOperation = "source-over";

    this.outCtx.drawImage(this.bg, 0, 0);
    this.outCtx.drawImage(this.person, 0, 0);

    const prev = this.preview;
    const ctx = this.previewCtx;
    if (prev && ctx) {
      if (prev.width !== w || prev.height !== h) {
        prev.width = w;
        prev.height = h;
      }
      ctx.drawImage(this.bg, 0, 0);
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.person, 0, 0);
      ctx.restore();
    }
  }
}
