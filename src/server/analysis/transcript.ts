import { normalizeToken, tokenize } from "@/lib/text";
import type { Interval, TimedText, TimingSource } from "@/lib/types";

/**
 * Transcript assembly (design §6.2, R6.7). Concatenates chunk segments in
 * order, splits words, and assigns word timing (ASR word timing when present,
 * otherwise interpolated by character weight).
 */
export interface ChunkTranscript {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  /** Session-relative ASR segments, or null when ASR returned no timestamps. */
  segments: TimedText[] | null;
  /** True when every segment is a single word with its own timing. */
  wordLevel: boolean;
  silences: Interval[];
}

export interface AssembledSegment {
  seq: number;
  startMs: number;
  endMs: number;
  text: string;
  wordCount: number;
  timingSource: TimingSource;
}

export interface AssembledWord {
  seq: number;
  segmentSeq: number;
  /** Display token, punctuation kept, capped at 64 characters. */
  word: string;
  norm: string;
  startMs: number;
  endMs: number;
  timingSource: TimingSource;
}

export interface AssembledTranscript {
  segments: AssembledSegment[];
  words: AssembledWord[];
  fullText: string;
  wordCount: number;
  timingGranularity: TimingSource;
}

const MAX_WORD_CHARS = 64;

interface DraftWord {
  word: string;
  norm: string;
  startMs: number;
  endMs: number;
  source: TimingSource;
}

function splitWords(text: string): { word: string; norm: string }[] {
  return tokenize(text)
    .map((t) => ({ word: t.slice(0, MAX_WORD_CHARS), norm: normalizeToken(t) }))
    .filter((w) => w.norm.length > 0);
}

/** Distributes words across [start, end] in proportion to (chars + 1). */
function interpolate(words: { word: string; norm: string }[], start: number, end: number): DraftWord[] {
  const span = Math.max(0, end - start);
  const weights = words.map((w) => w.word.length + 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = start;
  return words.map((w, i) => {
    const len = (span * (weights[i] ?? 1)) / total;
    const s = Math.round(cursor);
    cursor += len;
    const e = i === words.length - 1 ? end : Math.round(cursor);
    return { ...w, startMs: s, endMs: Math.max(s, e), source: "interpolated" as const };
  });
}

/** Voiced regions of a chunk: its span minus its silences. */
function voicedRegions(chunk: ChunkTranscript): Interval[] {
  const regions: Interval[] = [];
  let cursor = chunk.startMs;
  const silences = [...chunk.silences].sort((a, b) => a.startMs - b.startMs);
  for (const s of silences) {
    const a = Math.max(chunk.startMs, s.startMs);
    const b = Math.min(chunk.endMs, s.endMs);
    if (b <= a) continue;
    if (a > cursor) regions.push({ startMs: cursor, endMs: a });
    cursor = Math.max(cursor, b);
  }
  if (cursor < chunk.endMs) regions.push({ startMs: cursor, endMs: chunk.endMs });
  return regions.length ? regions : [{ startMs: chunk.startMs, endMs: chunk.endMs }];
}

/** Spreads words across voiced regions only, proportionally to character weight. */
function interpolateAcrossRegions(words: { word: string; norm: string }[], regions: Interval[]): DraftWord[] {
  const voicedTotal = regions.reduce((a, r) => a + (r.endMs - r.startMs), 0);
  if (voicedTotal <= 0 || words.length === 0) return [];
  const weights = words.map((w) => w.word.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const toTime = (voicedOffset: number): number => {
    let remaining = voicedOffset;
    for (const r of regions) {
      const len = r.endMs - r.startMs;
      if (remaining <= len) return r.startMs + remaining;
      remaining -= len;
    }
    const last = regions[regions.length - 1];
    return last ? last.endMs : 0;
  };
  let acc = 0;
  return words.map((w, i) => {
    const s = Math.round(toTime((acc / total) * voicedTotal));
    acc += weights[i] ?? 1;
    const e = Math.round(toTime((acc / total) * voicedTotal));
    return { ...w, startMs: s, endMs: Math.max(s, e), source: "interpolated" as const };
  });
}

const TERMINAL = /[.?!]["')\]]*$/;

export function assembleTranscript(chunks: ChunkTranscript[]): AssembledTranscript {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const segments: AssembledSegment[] = [];
  const words: AssembledWord[] = [];
  let anyInterpolatedChunk = false;
  let allWordLevel = ordered.length > 0;
  let prevSegEnd = 0;
  let prevWordStart = 0;

  const pushSegment = (draft: DraftWord[], segSource: TimingSource) => {
    if (draft.length === 0) return;
    const seq = segments.length;
    let segStart = Math.max(prevSegEnd, draft[0]?.startMs ?? prevSegEnd);
    let segEnd = Math.max(segStart, draft[draft.length - 1]?.endMs ?? segStart);
    segStart = Math.max(segStart, prevWordStart);
    segEnd = Math.max(segEnd, segStart);
    for (const d of draft) {
      const s = Math.min(segEnd, Math.max(d.startMs, segStart, prevWordStart));
      const e = Math.min(segEnd, Math.max(d.endMs, s));
      words.push({
        seq: words.length,
        segmentSeq: seq,
        word: d.word,
        norm: d.norm,
        startMs: s,
        endMs: e,
        timingSource: d.source,
      });
      prevWordStart = s;
    }
    segments.push({
      seq,
      startMs: segStart,
      endMs: segEnd,
      text: draft.map((d) => d.word).join(" "),
      wordCount: draft.length,
      timingSource: segSource,
    });
    prevSegEnd = segEnd;
  };

  for (const chunk of ordered) {
    const hasSegments = chunk.segments !== null && chunk.segments.length > 0;
    if (!chunk.wordLevel) allWordLevel = false;
    if (!hasSegments) {
      const all = splitWords(chunk.text);
      if (all.length === 0) continue;
      anyInterpolatedChunk = true;
      allWordLevel = false;
      pushSegment(interpolateAcrossRegions(all, voicedRegions(chunk)), "interpolated");
      continue;
    }
    const segs = chunk.segments ?? [];
    if (chunk.wordLevel) {
      // One ASR chunk per word: group into readable segments.
      let group: DraftWord[] = [];
      let lastEnd = -Infinity;
      for (const seg of segs) {
        const parts = splitWords(seg.text);
        if (parts.length === 0) continue;
        const draft = interpolate(parts, seg.startMs, seg.endMs).map((d) => ({
          ...d,
          source: (parts.length === 1 ? "asr_word" : "interpolated") as TimingSource,
        }));
        const gap = seg.startMs - lastEnd;
        if (group.length > 0 && (gap >= 1500 || group.length >= 25)) {
          pushSegment(group, "asr_word");
          group = [];
        }
        group.push(...draft);
        lastEnd = seg.endMs;
        const lastWord = draft[draft.length - 1];
        if (lastWord && TERMINAL.test(lastWord.word)) {
          pushSegment(group, "asr_word");
          group = [];
        }
      }
      pushSegment(group, "asr_word");
    } else {
      for (const seg of segs) {
        const parts = splitWords(seg.text);
        pushSegment(interpolate(parts, seg.startMs, seg.endMs), "asr_segment");
      }
    }
  }

  const timingGranularity: TimingSource = anyInterpolatedChunk
    ? "interpolated"
    : allWordLevel && words.length > 0
      ? "asr_word"
      : "asr_segment";

  return {
    segments,
    words,
    fullText: segments.map((s) => s.text).join(" "),
    wordCount: words.length,
    timingGranularity,
  };
}
