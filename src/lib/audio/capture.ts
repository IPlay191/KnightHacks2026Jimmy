"use client";

/**
 * AudioWorklet PCM capture plus an AnalyserNode for the level meter
 * (R5.1, design §10.5). The AudioContext runs at the device rate; resampling
 * to 16 kHz happens once at stop.
 */
export class PcmCapture {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private blocks: Float32Array[] = [];
  private frames = 0;
  private flushWaiter: (() => void) | null = null;

  static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.AudioContext === "function" &&
      typeof window.AudioWorkletNode === "function"
    );
  }

  async attach(stream: MediaStream): Promise<AnalyserNode> {
    await this.close();
    const ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (event: MessageEvent<{ type: string; samples?: Float32Array }>) => {
      if (event.data.type === "pcm" && event.data.samples) {
        this.blocks.push(event.data.samples);
        this.frames += event.data.samples.length;
      } else if (event.data.type === "flushed") {
        this.flushWaiter?.();
        this.flushWaiter = null;
      }
    };
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(node);
    source.connect(analyser);
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    this.ctx = ctx;
    this.node = node;
    this.source = source;
    this.analyser = analyser;
    return analyser;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  get capturedMs(): number {
    return Math.round((this.frames / this.sampleRate) * 1000);
  }

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  reset(): void {
    this.blocks = [];
    this.frames = 0;
  }

  setCapturing(on: boolean): void {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    this.node?.port.postMessage({ type: "capture", value: on });
  }

  /** Stops capturing and returns everything captured so far. */
  async drain(): Promise<{ blocks: Float32Array[]; sampleRate: number }> {
    if (this.node) {
      const flushed = new Promise<void>((resolve) => {
        this.flushWaiter = resolve;
        setTimeout(resolve, 500);
      });
      this.node.port.postMessage({ type: "capture", value: false });
      this.node.port.postMessage({ type: "flush" });
      await flushed;
    }
    const out = { blocks: this.blocks, sampleRate: this.sampleRate };
    this.blocks = [];
    this.frames = 0;
    return out;
  }

  async close(): Promise<void> {
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.analyser?.disconnect();
    } catch {
      // already disconnected
    }
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.node = null;
    this.source = null;
    this.analyser = null;
  }
}
