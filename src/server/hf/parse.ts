import {
  CoachingFeedback,
  CONTENT_VERDICTS,
  IMPROVEMENT_CATEGORIES,
  SCHEMA_VERSION,
  TEXT_LIMITS,
  type ContentVerdict,
} from "@/lib/coaching";
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
  const result = CoachingFeedback.safeParse(coerceCoaching(data));
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, failure: "schema", issues, raw: candidate };
  }
  return { ok: true, value: result.data };
}

// ---------------------------------------------------------------------------
// Lenient coercion. Models often return almost-valid JSON: a string a little
// too long, a score as "85" or 8.5, a missing optional note, an extra
// improvement. Rejecting those wastes the whole coaching step, so they're
// repaired deterministically before strict validation. Structural problems
// (missing scores, no improvements) still fail and go to the repair prompt.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Trims and cuts a string to `max` characters at a word boundary. */
export function clip(value: unknown, max: number): string | undefined {
  if (typeof value === "number") value = String(value);
  if (typeof value !== "string") return undefined;
  const t = value.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

function score(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return undefined;
  // Some models answer on a 0–10 scale; a fractional value at or below 10 is a strong hint.
  const scaled = n > 0 && n <= 10 && !Number.isInteger(n) ? n * 10 : n;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(true|yes|1)$/i.test(value.trim());
  return undefined;
}

function nullableText(value: unknown, max: number): string | null {
  const t = clip(value, max);
  return t && t.length > 0 && !/^(null|none|n\/a)$/i.test(t) ? t : null;
}

const CATEGORY_ALIASES: Record<string, (typeof IMPROVEMENT_CATEGORIES)[number]> = {
  pace: "pacing",
  speed: "pacing",
  filler: "fillers",
  "filler words": "fillers",
  pause: "pauses",
  content: "clarity",
  coherence: "clarity",
  organization: "structure",
  engagement: "audience",
  "audience fit": "audience",
  audiencefit: "audience",
  vocabulary: "audience",
};

function category(value: unknown): (typeof IMPROVEMENT_CATEGORIES)[number] {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if ((IMPROVEMENT_CATEGORIES as readonly string[]).includes(v)) return v as (typeof IMPROVEMENT_CATEGORIES)[number];
  return CATEGORY_ALIASES[v] ?? "delivery";
}

function priority(value: unknown): "high" | "medium" | "low" {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return v === "high" || v === "low" ? v : "medium";
}

/** Derives a verdict from content scores when the model omitted or mangled it. */
export function verdictFromScores(clarity: number | undefined, structure: number | undefined): ContentVerdict {
  const vals = [clarity, structure].filter((x): x is number => typeof x === "number");
  if (!vals.length) return "adequate";
  const m = Math.min(...vals);
  if (m < 25) return "incoherent";
  if (m < 50) return "weak";
  if (m < 70) return "adequate";
  if (m < 88) return "strong";
  return "excellent";
}

export function coerceCoaching(data: unknown): unknown {
  if (!isObj(data)) return data;
  const d = data;
  const clarity = isObj(d.clarity) ? d.clarity : {};
  const structure = isObj(d.structure) ? d.structure : {};
  const fit = isObj(d.audienceFit) ? d.audienceFit : isObj(d.audience_fit) ? d.audience_fit : {};
  const fr = isObj(d.fillerReview) ? d.fillerReview : {};
  const clarityScore = score(clarity.score);
  const structureScore = score(structure.score);
  const verdictRaw = typeof d.contentVerdict === "string" ? d.contentVerdict.trim().toLowerCase() : "";
  const contentVerdict = (CONTENT_VERDICTS as readonly string[]).includes(verdictRaw)
    ? verdictRaw
    : verdictFromScores(clarityScore, structureScore);

  const tipsRaw = Array.isArray(fit.tips) ? fit.tips : typeof fit.tips === "string" ? [fit.tips] : [];
  const ids = Array.isArray(fr.confirmedCandidateIds) ? fr.confirmedCandidateIds : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    contentVerdict,
    mainMessage: nullableText(d.mainMessage, TEXT_LIMITS.mainMessage),
    summary: clip(d.summary, TEXT_LIMITS.summary),
    clarity: { score: clarityScore, rationale: clip(clarity.rationale, TEXT_LIMITS.rationale) },
    structure: {
      score: structureScore,
      hasClearOpening: bool(structure.hasClearOpening) ?? false,
      hasClearClosing: bool(structure.hasClearClosing) ?? false,
      rationale: clip(structure.rationale, TEXT_LIMITS.rationale),
    },
    audienceFit: {
      score: score(fit.score),
      rationale: clip(fit.rationale, TEXT_LIMITS.rationale),
      tips: tipsRaw
        .map((t) => clip(t, TEXT_LIMITS.tip))
        .filter((t): t is string => Boolean(t && t.length >= 10))
        .slice(0, 3),
    },
    pacingInsight: clip(d.pacingInsight, TEXT_LIMITS.pacingInsight) ?? "See the pace chart for how your speed changed.",
    fillerReview: {
      confirmedCandidateIds: ids
        .map((x) => (typeof x === "number" ? `c${x}` : typeof x === "string" ? x.trim() : ""))
        .filter((x) => /^c\d{1,3}$/.test(x))
        .slice(0, 150),
      note: clip(fr.note, TEXT_LIMITS.note) ?? "",
    },
    strengths: (Array.isArray(d.strengths) ? d.strengths : [])
      .filter(isObj)
      .map((s) => ({ title: clip(s.title, TEXT_LIMITS.title), detail: clip(s.detail, TEXT_LIMITS.detail) }))
      .slice(0, 3),
    improvements: (Array.isArray(d.improvements) ? d.improvements : [])
      .filter(isObj)
      .map((i) => ({
        title: clip(i.title, TEXT_LIMITS.title),
        detail: clip(i.detail, TEXT_LIMITS.detail),
        category: category(i.category),
        priority: priority(i.priority),
        evidenceQuote: nullableText(i.evidenceQuote, TEXT_LIMITS.quote),
        suggestedRewrite: nullableText(i.suggestedRewrite, TEXT_LIMITS.rewrite),
      }))
      .slice(0, 5),
  };
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
