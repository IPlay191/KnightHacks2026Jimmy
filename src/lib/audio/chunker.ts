/**
 * Splits 16 kHz mono PCM into upload chunks (R5.2, design §10.5, P1).
 * Every chunk is at most 28 s; every non-final chunk is at least 18 s and is
 * cut at the center of the quietest 100 ms window between 18 s and 28 s.
 */
export const SAMPLE_RATE = 16000;
export const MIN_CHUNK_SEC = 18;
export const MAX_CHUNK_SEC = 28;
const WINDOW_SEC = 0.1;
const STEP_SEC = 0.02;

export interface ChunkBounds {
  index: number;
  startSample: number;
  endSample: number;
  startMs: number;
  endMs: number;
}

function windowEnergy(samples: Float32Array, start: number, len: number): number {
  let sum = 0;
  const end = Math.min(samples.length, start + len);
  for (let i = start; i < end; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return sum;
}

export const samplesToMs = (n: number, sampleRate = SAMPLE_RATE) => Math.round((n * 1000) / sampleRate);

export function planChunks(samples: Float32Array, sampleRate = SAMPLE_RATE): ChunkBounds[] {
  const total = samples.length;
  const minLen = MIN_CHUNK_SEC * sampleRate;
  const maxLen = MAX_CHUNK_SEC * sampleRate;
  const win = Math.round(WINDOW_SEC * sampleRate);
  const step = Math.max(1, Math.round(STEP_SEC * sampleRate));
  const bounds: { start: number; end: number }[] = [];
  let cursor = 0;
  while (total - cursor > maxLen) {
    let bestStart = -1;
    let bestEnergy = Infinity;
    for (let s = cursor + minLen; s + win <= cursor + maxLen; s += step) {
      const e = windowEnergy(samples, s, win);
      if (e < bestEnergy) {
        bestEnergy = e;
        bestStart = s;
      }
    }
    const cut = bestStart >= 0 ? bestStart + Math.floor(win / 2) : cursor + maxLen;
    bounds.push({ start: cursor, end: cut });
    cursor = cut;
  }
  if (total - cursor > 0) bounds.push({ start: cursor, end: total });
  return bounds.map((b, index) => ({
    index,
    startSample: b.start,
    endSample: b.end,
    startMs: samplesToMs(b.start, sampleRate),
    endMs: samplesToMs(b.end, sampleRate),
  }));
}
