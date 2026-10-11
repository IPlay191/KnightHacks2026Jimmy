import { z } from "zod";

/**
 * Structured coaching output (design §4.5, R8.7, R20.5). This is the contract
 * the LLM must satisfy. All fields are required; optional values are nullable
 * so strict JSON-schema providers accept it.
 *
 * v2: adds `mainMessage` and `contentVerdict` (used as a hard score gate),
 * requires at least two improvements, and drops the practice drill.
 */
export const SCHEMA_VERSION = 2 as const;

export const TEXT_LIMITS = {
  summary: 500,
  rationale: 400,
  tip: 240,
  title: 90,
  detail: 500,
  quote: 200,
  rewrite: 360,
  mainMessage: 240,
  note: 240,
  pacingInsight: 400,
} as const;

const Text = (min: number, max: number) => z.string().trim().min(min).max(max);
const Score = z.number().int().min(0).max(100);

export const IMPROVEMENT_CATEGORIES = [
  "pacing",
  "fillers",
  "pauses",
  "clarity",
  "structure",
  "delivery",
  "audience",
] as const;

/** Overall judgment of the speech's content. Caps the overall score (design §6.5). */
export const CONTENT_VERDICTS = ["incoherent", "weak", "adequate", "strong", "excellent"] as const;
export type ContentVerdict = (typeof CONTENT_VERDICTS)[number];

export const Improvement = z.object({
  title: Text(3, TEXT_LIMITS.title),
  detail: Text(10, TEXT_LIMITS.detail),
  category: z.enum(IMPROVEMENT_CATEGORIES),
  priority: z.enum(["high", "medium", "low"]),
  evidenceQuote: Text(1, TEXT_LIMITS.quote).nullable(),
  suggestedRewrite: Text(1, TEXT_LIMITS.rewrite).nullable(),
});
export type Improvement = z.infer<typeof Improvement>;

export const Strength = z.object({ title: Text(3, TEXT_LIMITS.title), detail: Text(10, TEXT_LIMITS.detail) });
export type Strength = z.infer<typeof Strength>;

export const CoachingFeedback = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  contentVerdict: z.enum(CONTENT_VERDICTS),
  mainMessage: Text(3, TEXT_LIMITS.mainMessage).nullable(),
  summary: Text(20, TEXT_LIMITS.summary),
  clarity: z.object({ score: Score, rationale: Text(10, TEXT_LIMITS.rationale) }),
  structure: z.object({
    score: Score,
    hasClearOpening: z.boolean(),
    hasClearClosing: z.boolean(),
    rationale: Text(10, TEXT_LIMITS.rationale),
  }),
  audienceFit: z.object({
    score: Score,
    rationale: Text(10, TEXT_LIMITS.rationale),
    tips: z.array(Text(10, TEXT_LIMITS.tip)).min(1).max(3),
  }),
  pacingInsight: Text(10, TEXT_LIMITS.pacingInsight),
  fillerReview: z.object({
    confirmedCandidateIds: z.array(z.string().regex(/^c\d{1,3}$/)).max(150),
    note: Text(0, TEXT_LIMITS.note),
  }),
  strengths: z.array(Strength).min(1).max(3),
  improvements: z.array(Improvement).min(2).max(5),
});
export type CoachingFeedback = z.infer<typeof CoachingFeedback>;

/** Legacy v1 drill shape, kept only so older stored payloads still type-check. */
export interface PracticeDrill {
  title: string;
  instructions: string;
  durationMinutes: number;
}

/**
 * What is persisted in `coaching_feedback.payload`. LLM output fits this
 * directly; rule-based feedback leaves the LLM-only judgments null.
 */
export interface StoredFeedback {
  schemaVersion: number;
  contentVerdict?: ContentVerdict | null;
  mainMessage?: string | null;
  summary: string;
  clarity: { score: number; rationale: string } | null;
  structure: { score: number; hasClearOpening: boolean; hasClearClosing: boolean; rationale: string } | null;
  audienceFit: { score: number | null; rationale: string | null; tips: string[] };
  pacingInsight: string;
  fillerReview: { confirmedCandidateIds: string[]; note: string } | null;
  strengths: Strength[];
  improvements: Improvement[];
  /** Why AI coaching was unavailable (rules feedback only). */
  unavailableReason?: string | null;
  /** Set when a hard cap lowered the overall score (design §6.5). */
  scoreCap?: { cap: number; weighted: number; reason: string } | null;
  /** v1 payloads only; no longer shown. */
  practiceDrill?: PracticeDrill;
}
