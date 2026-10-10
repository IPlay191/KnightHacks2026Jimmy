/** Resampling captured PCM to 16 kHz mono (R5.2, design §10.5). */
export const TARGET_RATE = 16000;

export function concatBlocks(blocks: Float32Array[]): Float32Array {
  const total = blocks.reduce((a, b) => a + b.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

/** Linear-interpolation resampler used when OfflineAudioContext isn't available. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate = TARGET_RATE): Float32Array {
  if (fromRate === toRate) return input.slice();
  const outLength = Math.max(0, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac;
  }
  return out;
}

/** High-quality resample with OfflineAudioContext, falling back to linear. */
export async function resampleTo16k(input: Float32Array, fromRate: number): Promise<Float32Array> {
  if (input.length === 0) return new Float32Array(0);
  if (fromRate === TARGET_RATE) return input.slice();
  const Offline =
    typeof window !== "undefined"
      ? (window.OfflineAudioContext ??
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext)
      : undefined;
  if (!Offline) return resampleLinear(input, fromRate);
  try {
    const length = Math.max(1, Math.ceil((input.length * TARGET_RATE) / fromRate));
    const ctx = new Offline(1, length, TARGET_RATE);
    const buffer = ctx.createBuffer(1, input.length, fromRate);
    buffer.copyToChannel(input as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    const rendered = await ctx.startRendering();
    return rendered.getChannelData(0).slice();
  } catch {
    return resampleLinear(input, fromRate);
  }
}
