/**
 * Virtual camera backgrounds: scene catalog, saved preference, and the pure
 * math used by the compositor. Kept free of DOM/MediaPipe imports so it can be
 * unit-tested in Node.
 */

export const BACKGROUND_IDS = ["none", "office", "classroom", "stage"] as const;
export type BackgroundId = (typeof BACKGROUND_IDS)[number];
export type SceneId = Exclude<BackgroundId, "none">;

export interface BackgroundScene {
  id: BackgroundId;
  label: string;
  description: string;
  /** Same-origin SVG scene; null for the plain camera. */
  src: string | null;
}

export const BACKGROUNDS: Record<BackgroundId, BackgroundScene> = {
  none: { id: "none", label: "No background", description: "Your real surroundings", src: null },
  office: {
    id: "office",
    label: "Office",
    description: "Boardroom pitch or team meeting",
    src: "/backgrounds/office.svg",
  },
  classroom: {
    id: "classroom",
    label: "Classroom",
    description: "Class presentation or lecture",
    src: "/backgrounds/classroom.svg",
  },
  stage: {
    id: "stage",
    label: "Stage",
    description: "Keynote, talk, or competition",
    src: "/backgrounds/stage.svg",
  },
};

export const BACKGROUND_STORAGE_KEY = "sr.background";

export function isBackgroundId(v: unknown): v is BackgroundId {
  return typeof v === "string" && (BACKGROUND_IDS as readonly string[]).includes(v);
}

export function loadBackgroundPref(): BackgroundId {
  try {
    const v = localStorage.getItem(BACKGROUND_STORAGE_KEY);
    return isBackgroundId(v) ? v : "none";
  } catch {
    return "none";
  }
}

export function saveBackgroundPref(id: BackgroundId): void {
  try {
    localStorage.setItem(BACKGROUND_STORAGE_KEY, id);
  } catch {
    // storage may be unavailable (private mode); the preference is optional
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Destination rect that scales a source to fully cover the target, centered (CSS `object-fit: cover`). */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** Confidence below `lo` is fully background, above `hi` fully person; smooth in between. */
export const MASK_EDGE = { lo: 0.25, hi: 0.75 } as const;
/** Weight of the newest mask in the temporal blend; lower = steadier edges, more lag. */
export const MASK_SMOOTHING = 0.65;

export function smoothstep(lo: number, hi: number, x: number): number {
  if (!Number.isFinite(x)) return 0;
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * Turns a person-confidence mask into RGBA alpha (black pixels, alpha = person).
 * Blends with the previous frame's confidence (stored in `prev`, updated in place)
 * to reduce edge flicker. `out` must hold `conf.length * 4` bytes.
 */
export function maskToAlpha(
  conf: Float32Array,
  prev: Float32Array | null,
  out: Uint8ClampedArray,
  smoothing = MASK_SMOOTHING,
): void {
  const blend = prev && prev.length === conf.length;
  for (let i = 0; i < conf.length; i++) {
    const c = Number.isFinite(conf[i]) ? conf[i] : 0;
    const v = blend ? prev[i] + (c - prev[i]) * smoothing : c;
    if (blend) prev[i] = v;
    const o = i * 4;
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
    out[o + 3] = Math.round(smoothstep(MASK_EDGE.lo, MASK_EDGE.hi, v) * 255);
  }
}
