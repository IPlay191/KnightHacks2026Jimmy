import { UNAMBIGUOUS_FILLERS } from "./fillers";

/**
 * Deterministic content-substance signals (design §6.5). They can't judge
 * meaning, but they reliably catch the cheap ways to game delivery metrics:
 * very little speech, or the same words and phrases repeated over and over.
 */
const WINDOW = 50;

function contentTokens(norms: string[]): string[] {
  return norms.filter((n) => n.length > 0 && !UNAMBIGUOUS_FILLERS.has(n));
}

/** Moving-average type-token ratio (MATTR) over 50-word windows, 0–1. */
export function lexicalDiversity(norms: string[]): number {
  const words = contentTokens(norms);
  if (words.length === 0) return 0;
  if (words.length <= WINDOW) return new Set(words).size / words.length;
  const counts = new Map<string, number>();
  for (let i = 0; i < WINDOW; i++) counts.set(words[i]!, (counts.get(words[i]!) ?? 0) + 1);
  let total = counts.size / WINDOW;
  let windows = 1;
  for (let i = WINDOW; i < words.length; i++) {
    const out = words[i - WINDOW]!;
    const left = (counts.get(out) ?? 1) - 1;
    if (left === 0) counts.delete(out);
    else counts.set(out, left);
    counts.set(words[i]!, (counts.get(words[i]!) ?? 0) + 1);
    total += counts.size / WINDOW;
    windows++;
  }
  return Math.round((total / windows) * 1000) / 1000;
}

/** Share of word trigrams that already appeared earlier in the speech, 0–1. */
export function repetitionRatio(norms: string[]): number {
  const words = contentTokens(norms);
  if (words.length < 3) return 0;
  const seen = new Set<string>();
  let repeats = 0;
  let total = 0;
  for (let i = 0; i + 2 < words.length; i++) {
    const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    if (seen.has(tri)) repeats++;
    else seen.add(tri);
    total++;
  }
  return Math.round((repeats / total) * 1000) / 1000;
}
