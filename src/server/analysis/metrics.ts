import type { FillerBreakdown, Interval, TimelineWindow } from "@/lib/types";
import { mergeIntervals, MIN_SILENCE_MS } from "./silence";

/**
 * Deterministic delivery metrics (design §6.3, R7.1, R7.7). Pure: the same
 * input always yields deep-equal output.
 */
export const METRICS_VERSION = 1;
export const PAUSE_MS = 500;
export const LONG_PAUSE_MS = 2000;
export const WINDOW_MS = 15000;
const MIN_WINDOW_MS = 5000;

export interface MetricsInput {
  /** Total recorded span (sum of chunk spans). */
  durationMs: number;
  words: { startMs: number; endMs: number }[];
  /** Session-relative silences from all chunks (may touch at chunk boundaries). */
  silences: Interval[];
  fillerCount: number;
  fillerBreakdown: FillerBreakdown;
}

export interface DeliveryMetrics {
  metricsVersion: number;
  durationMs: number;
  speakingMs: number;
  wordCount: number;
  wpm: number;
  articulationWpm: number;
  wpmStddev: number;
  wpmTimeline: TimelineWindow[];
  pauses: Interval[];
  pauseCount: number;
  longPauseCount: number;
  longestPauseMs: number;
  pauseRatio: number;
  fillerCount: number;
  fillersPerMin: number;
  fillerBreakdown: FillerBreakdown;
  /** Span used for rates: duration minus leading and trailing silence. */
  activeMs: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function clampInterval(i: Interval, lo: number, hi: number): Interval | null {
  const s = Math.max(lo, i.startMs);
  const e = Math.min(hi, i.endMs);
  return e > s ? { startMs: s, endMs: e } : null;
}

export function computeMetrics(input: MetricsInput): DeliveryMetrics {
  const durationMs = Math.max(0, Math.round(input.durationMs));
  const wordCount = input.words.length;

  const merged = mergeIntervals(
    input.silences.map((s) => clampInterval(s, 0, durationMs)).filter((s): s is Interval => s !== null),
  ).filter((s) => s.endMs - s.startMs >= MIN_SILENCE_MS);

  // Leading and trailing silence are excluded from pause metrics and rates.
  let activeStart = 0;
  let activeEnd = durationMs;
  const first = merged[0];
  if (first && first.startMs <= 0) activeStart = first.endMs;
  const last = merged[merged.length - 1];
  if (last && last.endMs >= durationMs) activeEnd = Math.max(activeStart, last.startMs);
  if (wordCount > 0) {
    const firstWord = input.words[0];
    const lastWord = input.words[wordCount - 1];
    if (firstWord) activeStart = Math.min(activeStart, firstWord.startMs);
    if (lastWord) activeEnd = Math.max(activeEnd, lastWord.endMs);
  }
  activeStart = Math.max(0, Math.min(activeStart, durationMs));
  activeEnd = Math.max(activeStart, Math.min(activeEnd, durationMs));
  const activeMs = activeEnd - activeStart;

  const inner = merged
    .map((s) => clampInterval(s, activeStart, activeEnd))
    .filter((s): s is Interval => s !== null && s.endMs - s.startMs >= MIN_SILENCE_MS);
  const silenceTotal = inner.reduce((a, s) => a + (s.endMs - s.startMs), 0);
  const speakingMs = Math.max(0, activeMs - silenceTotal);

  const pauses = inner.filter((s) => s.endMs - s.startMs >= PAUSE_MS);
  const pauseCount = pauses.length;
  const longPauseCount = pauses.filter((s) => s.endMs - s.startMs >= LONG_PAUSE_MS).length;
  const longestPauseMs = pauses.reduce((m, s) => Math.max(m, s.endMs - s.startMs), 0);
  const pauseTotal = pauses.reduce((a, s) => a + (s.endMs - s.startMs), 0);
  const pauseRatio = durationMs > 0 ? round3(Math.min(1, pauseTotal / durationMs)) : 0;

  const rateMs = activeMs > 0 ? activeMs : durationMs;
  const wpm = rateMs > 0 ? round1(wordCount / (rateMs / 60000)) : 0;
  const articulationWpm = speakingMs > 0 ? round1(wordCount / (speakingMs / 60000)) : 0;

  const wpmTimeline = buildTimeline(input.words, activeEnd);
  const fullWindows = wpmTimeline.filter((w) => w.endMs - w.startMs >= MIN_WINDOW_MS);
  let wpmStddev = 0;
  if (fullWindows.length >= 2) {
    const mean = fullWindows.reduce((a, w) => a + w.wpm, 0) / fullWindows.length;
    const variance = fullWindows.reduce((a, w) => a + (w.wpm - mean) ** 2, 0) / fullWindows.length;
    wpmStddev = round1(Math.sqrt(variance));
  }

  const fillersPerMin = rateMs > 0 ? round2(input.fillerCount / (rateMs / 60000)) : 0;

  return {
    metricsVersion: METRICS_VERSION,
    durationMs,
    speakingMs,
    wordCount,
    wpm,
    articulationWpm,
    wpmStddev,
    wpmTimeline,
    pauses,
    pauseCount,
    longPauseCount,
    longestPauseMs,
    pauseRatio,
    fillerCount: input.fillerCount,
    fillersPerMin,
    fillerBreakdown: input.fillerBreakdown,
    activeMs,
  };
}

/**
 * 15 s windows from the first word. A word belongs to the window containing
 * its start. A final window shorter than 5 s merges into the previous one.
 */
export function buildTimeline(words: { startMs: number }[], endMs: number): TimelineWindow[] {
  if (words.length === 0) return [];
  const origin = words[0]?.startMs ?? 0;
  const lastStart = words[words.length - 1]?.startMs ?? origin;
  const end = Math.max(endMs, lastStart + 1);
  const bounds: Interval[] = [];
  for (let s = origin; s < end; s += WINDOW_MS) bounds.push({ startMs: s, endMs: Math.min(end, s + WINDOW_MS) });
  if (bounds.length >= 2) {
    const tail = bounds[bounds.length - 1];
    const prev = bounds[bounds.length - 2];
    if (tail && prev && tail.endMs - tail.startMs < MIN_WINDOW_MS) {
      prev.endMs = tail.endMs;
      bounds.pop();
    }
  }
  const counts = new Array<number>(bounds.length).fill(0);
  for (const w of words) {
    let idx = Math.floor((w.startMs - origin) / WINDOW_MS);
    idx = Math.max(0, Math.min(bounds.length - 1, idx));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return bounds.map((b, i) => {
    const words = counts[i] ?? 0;
    const span = b.endMs - b.startMs;
    return { startMs: b.startMs, endMs: b.endMs, words, wpm: span > 0 ? round1(words / (span / 60000)) : 0 };
  });
}
