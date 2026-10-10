/** Text normalization shared by transcript assembly, filler detection, and the UI. */

/** Lowercase, curly quotes → straight, strip punctuation except apostrophes. */
export function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, "")
    .replace(/^'+|'+$/g, "");
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

/** Collapses whitespace and lowercases for quote matching. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordCount(text: string): number {
  return tokenize(text).length;
}
