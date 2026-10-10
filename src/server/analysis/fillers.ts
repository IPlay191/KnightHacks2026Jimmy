import { normalizeToken } from "@/lib/text";
import type { FillerBreakdown, FillerStatus } from "@/lib/types";

/**
 * Filler detection (design §6.4, R7.3–7.5). Unambiguous disfluencies are
 * always counted. Contextual words and phrases become candidates the LLM
 * confirms or rejects; it can never add fillers.
 */
export const UNAMBIGUOUS_FILLERS = new Set(["um", "umm", "uhm", "uh", "uhh", "er", "erm", "ah", "hmm", "mm", "mhm"]);
export const CONTEXTUAL_WORDS = ["like", "so", "basically", "actually", "literally", "right", "okay", "well"];
export const CONTEXTUAL_PHRASES = ["you know", "i mean", "kind of", "sort of"];
export const MAX_CANDIDATES_REVIEWED = 150;
const CONTEXT_WORDS = 6;

export interface FillerWordInput {
  seq: number;
  word: string;
  norm: string;
  startMs: number;
}

export interface FillerCandidate {
  id: string;
  phrase: string;
  /** seq of the first word of the span */
  wordSeq: number;
  span: number;
  startMs: number;
  context: string;
}

export interface FillerHit {
  wordSeq: number;
  phrase: string;
  span: number;
  startMs: number;
}

export interface FillerDetection {
  unambiguous: FillerHit[];
  candidates: FillerCandidate[];
}

/** Normalizes a user-defined filler ("You Know" → ["you", "know"]). */
export function customFillerTokens(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((t) => normalizeToken(t))
    .filter((t) => t.length > 0);
}

export function detectFillers(words: FillerWordInput[], customFillers: string[] = []): FillerDetection {
  const phrases = new Map<string, string[]>();
  for (const p of CONTEXTUAL_PHRASES) phrases.set(p, p.split(" "));
  const singles = new Set(CONTEXTUAL_WORDS);
  for (const raw of customFillers) {
    const toks = customFillerTokens(raw);
    if (toks.length === 0) continue;
    const key = toks.join(" ");
    if (toks.length === 1) {
      if (!UNAMBIGUOUS_FILLERS.has(key)) singles.add(key);
    } else {
      phrases.set(key, toks);
    }
  }
  // Longest phrases first so "you know" wins over a custom "you".
  const phraseList = [...phrases.entries()].sort((a, b) => b[1].length - a[1].length);

  const unambiguous: FillerHit[] = [];
  const candidates: FillerCandidate[] = [];
  const contextFor = (i: number, span: number): string => {
    const from = Math.max(0, i - CONTEXT_WORDS);
    const to = Math.min(words.length, i + span + CONTEXT_WORDS);
    return words
      .slice(from, to)
      .map((w, k) => (from + k === i ? `[${w.word}` : w.word) + (from + k === i + span - 1 ? "]" : ""))
      .join(" ");
  };

  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (!w) break;
    if (UNAMBIGUOUS_FILLERS.has(w.norm)) {
      unambiguous.push({ wordSeq: w.seq, phrase: w.norm, span: 1, startMs: w.startMs });
      i += 1;
      continue;
    }
    let matched = false;
    for (const [key, toks] of phraseList) {
      if (toks.every((t, k) => words[i + k]?.norm === t)) {
        candidates.push({
          id: `c${candidates.length + 1}`,
          phrase: key,
          wordSeq: w.seq,
          span: toks.length,
          startMs: w.startMs,
          context: contextFor(i, toks.length),
        });
        i += toks.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (singles.has(w.norm)) {
      candidates.push({
        id: `c${candidates.length + 1}`,
        phrase: w.norm,
        wordSeq: w.seq,
        span: 1,
        startMs: w.startMs,
        context: contextFor(i, 1),
      });
    }
    i += 1;
  }
  return { unambiguous, candidates };
}

export interface FillerResolution {
  count: number;
  breakdown: FillerBreakdown;
  /** Status keyed by word seq of the first word of each hit. */
  statusBySeq: Map<number, { phrase: string; status: FillerStatus }>;
  /** Start times of counted fillers, for the pace timeline rug. */
  countedTimesMs: number[];
}

/**
 * Applies LLM confirmations. `confirmedIds === null` means rules feedback:
 * contextual candidates stay unreviewed and are excluded from the count (R7.5).
 */
export function resolveFillers(detection: FillerDetection, confirmedIds: Iterable<string> | null): FillerResolution {
  const reviewable = new Set(detection.candidates.slice(0, MAX_CANDIDATES_REVIEWED).map((c) => c.id));
  const confirmed = new Set<string>();
  if (confirmedIds) {
    for (const id of confirmedIds) if (reviewable.has(id)) confirmed.add(id);
  }
  const breakdown: FillerBreakdown = {};
  const statusBySeq = new Map<number, { phrase: string; status: FillerStatus }>();
  const countedTimesMs: number[] = [];
  let count = 0;

  for (const hit of detection.unambiguous) {
    const entry = (breakdown[hit.phrase] ??= { count: 0, confirmed: false });
    entry.count += 1;
    count += 1;
    statusBySeq.set(hit.wordSeq, { phrase: hit.phrase, status: "unambiguous" });
    countedTimesMs.push(hit.startMs);
  }
  for (const c of detection.candidates) {
    let status: FillerStatus;
    if (confirmedIds === null || !reviewable.has(c.id)) status = "unreviewed";
    else status = confirmed.has(c.id) ? "confirmed" : "rejected";
    statusBySeq.set(c.wordSeq, { phrase: c.phrase, status });
    if (status === "confirmed") {
      const entry = (breakdown[c.phrase] ??= { count: 0, confirmed: true });
      entry.count += 1;
      entry.confirmed = true;
      count += 1;
      countedTimesMs.push(c.startMs);
    }
  }
  countedTimesMs.sort((a, b) => a - b);
  return { count, breakdown, statusBySeq, countedTimesMs };
}
