import { normalizeToken } from "@/lib/text";
import { UNAMBIGUOUS_FILLERS } from "./fillers";

/**
 * Flesch-Kincaid grade level of a spoken transcript (design §6.6, R20.5).
 * Approximate on speech: sentence boundaries come from Whisper punctuation,
 * with each segment end also treated as a boundary when unpunctuated.
 */
export const MIN_GRADE = 0;
export const MAX_GRADE = 18;

/** Deterministic English syllable heuristic, minimum 1 per word. */
export function countSyllables(word: string): number {
  let w = normalizeToken(word).replace(/'/g, "");
  if (!w) return 0;
  if (/^\d+$/.test(w)) return Math.max(1, w.length); // digits read roughly per digit
  if (w.length <= 3) return 1;
  // Drop a silent final "e"/"es"/"ed" (but keep consonant + "le", as in "ta-ble").
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  w = w.replace(/^y/, "");
  const groups = w.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 0);
}

export interface ReadabilityInput {
  /** Segment texts in order. */
  segments: string[];
}

export function readingGrade(input: ReadabilityInput): number {
  let sentences = 0;
  let wordsCount = 0;
  let syllables = 0;
  for (const seg of input.segments) {
    const tokens = seg.split(/\s+/).filter(Boolean);
    let inSentence = false;
    for (const tok of tokens) {
      const norm = normalizeToken(tok);
      if (!norm || UNAMBIGUOUS_FILLERS.has(norm)) {
        if (/[.?!]["')\]]*$/.test(tok) && inSentence) {
          sentences += 1;
          inSentence = false;
        }
        continue;
      }
      wordsCount += 1;
      syllables += countSyllables(tok);
      inSentence = true;
      if (/[.?!]["')\]]*$/.test(tok)) {
        sentences += 1;
        inSentence = false;
      }
    }
    if (inSentence) sentences += 1;
  }
  if (wordsCount === 0 || sentences === 0) return 0;
  const grade = 0.39 * (wordsCount / sentences) + 11.8 * (syllables / wordsCount) - 15.59;
  const clamped = Math.min(MAX_GRADE, Math.max(MIN_GRADE, grade));
  return Math.round(clamped * 10) / 10;
}

/** 100 at or below the target; −15 per grade above it (design §6.5). */
export function readabilityScore(grade: number, targetGrade: number): number {
  if (grade <= targetGrade) return 100;
  return Math.max(0, Math.min(100, Math.round(100 - 15 * (grade - targetGrade))));
}
