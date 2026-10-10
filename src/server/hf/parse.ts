import { CoachingFeedback } from "@/lib/coaching";
import { normalizeForMatch } from "@/lib/text";

/**
 * LLM output parsing and normalization (design §4.5–4.6, R8.4). Pure; never
 * throws on normalization (P9).
 */

/** Index just past the `}` that balances the `{` at `start` (string-aware), or -1. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Strips code fences, then returns the first balanced `{…}` that parses as a
 * JSON object. Prose before the JSON may itself contain braces. Returns the
 * first balanced candidate when none parse (so callers can report the error),
 * or null when there's no `{` at all.
 */
export function extractJson(raw: string): string | null {
  let text = raw.trim();
  const fence = text.match(/```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```/);
  if (fence?.[1] !== undefined && fence[1].includes("{")) text = fence[1].trim();
  let firstCandidate: string | null = null;
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    const end = balancedEnd(text, start);
    if (end < 0) continue;
    const candidate = text.slice(start, end);
    firstCandidate ??= candidate;
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return candidate;
    } catch {
      // keep scanning
    }
  }
  return firstCandidate;
}

export type ParseOutcome =
  | { ok: true; value: CoachingFeedback }
  | { ok: false; failure: "json_parse" | "schema"; issues: string[]; raw: string };

export function parseCoaching(raw: string): ParseOutcome {
  const candidate = extractJson(raw);
  if (candidate === null) return { ok: false, failure: "json_parse", issues: ["No JSON object found."], raw };
  let data: unknown;
  try {
    data = JSON.parse(candidate);
  } catch (e) {
    return { ok: false, failure: "json_parse", issues: [(e as Error).message.slice(0, 200)], raw };
  }
  const result = CoachingFeedback.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, failure: "schema", issues, raw: candidate };
  }
  return { ok: true, value: result.data };
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * Deterministic post-validation normalization: drops unknown or duplicate
 * filler IDs, nulls quotes that are too long or not in the transcript, and
 * sorts improvements by priority (stable within a priority). Idempotent.
 */
export function normalizeCoaching(
  fb: CoachingFeedback,
  ctx: { candidateIds: Set<string>; transcript: string },
): CoachingFeedback {
  const seen = new Set<string>();
  const confirmed = fb.fillerReview.confirmedCandidateIds.filter((id) => {
    if (!ctx.candidateIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const haystack = normalizeForMatch(ctx.transcript);
  const improvements = fb.improvements
    .map((imp, idx) => {
      let quote = imp.evidenceQuote;
      if (quote !== null) {
        const words = quote.trim().split(/\s+/).filter(Boolean);
        const needle = normalizeForMatch(quote);
        if (words.length > 20 || needle.length === 0 || !haystack.includes(needle)) quote = null;
      }
      return { imp: { ...imp, evidenceQuote: quote }, idx };
    })
    .sort((a, b) => PRIORITY_ORDER[a.imp.priority] - PRIORITY_ORDER[b.imp.priority] || a.idx - b.idx)
    .map((x) => x.imp);
  return { ...fb, fillerReview: { ...fb.fillerReview, confirmedCandidateIds: confirmed }, improvements };
}
