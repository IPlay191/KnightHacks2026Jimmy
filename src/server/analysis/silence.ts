import type { Interval } from "@/lib/types";

/**
 * Adaptive energy-based silence detection (design §6.1, R7.2).
 * 20 ms frames; threshold = noise floor (10th percentile) + 10 dB, clamped to
 * [-50, -30] dBFS; silent runs of at least 300 ms become silences.
 */
export const FRAME_MS = 20;
export const MIN_SILENCE_MS = 300;
const SILENCE_DB_FLOOR = -100;

export interface SilenceResult {
  /** Session-relative silence intervals, sorted and non-overlapping. */
  silences: Interval[];
  /** Fraction of frames above the threshold, 0–1. */
  voicedRatio: number;
  thresholdDb: number;
}

export function frameLevelsDb(samples: Int16Array, sampleRate: number): Float64Array {
  const frameLen = Math.round((sampleRate * FRAME_MS) / 1000);
  const frames = Math.floor(samples.length / frameLen);
  const levels = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * frameLen;
    for (let i = 0; i < frameLen; i++) {
      const v = (samples[base + i] ?? 0) / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / frameLen);
    levels[f] = rms > 0 ? Math.max(SILENCE_DB_FLOOR, 20 * Math.log10(rms)) : SILENCE_DB_FLOOR;
  }
  return levels;
}

function percentile(values: Float64Array, p: number): number {
  if (values.length === 0) return SILENCE_DB_FLOOR;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx] ?? SILENCE_DB_FLOOR;
}

export function detectSilences(samples: Int16Array, sampleRate: number, offsetMs = 0): SilenceResult {
  const levels = frameLevelsDb(samples, sampleRate);
  if (levels.length === 0) return { silences: [], voicedRatio: 0, thresholdDb: -50 };
  const noiseFloor = percentile(levels, 0.1);
  const thresholdDb = Math.min(-30, Math.max(noiseFloor + 10, -50));
  const minFrames = Math.ceil(MIN_SILENCE_MS / FRAME_MS);

  const silences: Interval[] = [];
  let voiced = 0;
  let runStart = -1;
  for (let f = 0; f <= levels.length; f++) {
    const silent = f < levels.length && (levels[f] ?? SILENCE_DB_FLOOR) < thresholdDb;
    if (f < levels.length && !silent) voiced++;
    if (silent && runStart < 0) runStart = f;
    if (!silent && runStart >= 0) {
      if (f - runStart >= minFrames) {
        silences.push({ startMs: offsetMs + runStart * FRAME_MS, endMs: offsetMs + f * FRAME_MS });
      }
      runStart = -1;
    }
  }
  return { silences, voicedRatio: voiced / levels.length, thresholdDb };
}

/** Sorts and merges overlapping or touching intervals (gap of 20 ms or less). */
export function mergeIntervals(intervals: Interval[], maxGapMs = FRAME_MS): Interval[] {
  const sorted = intervals
    .filter((i) => i.endMs > i.startMs)
    .map((i) => ({ ...i }))
    .sort((a, b) => a.startMs - b.startMs);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.startMs - last.endMs <= maxGapMs) last.endMs = Math.max(last.endMs, cur.endMs);
    else out.push(cur);
  }
  return out;
}
