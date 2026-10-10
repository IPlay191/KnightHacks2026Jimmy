import { z } from "zod";

/**
 * Structured coaching output (design §4.5, R8.7, R20.5). This is the contract
 * the LLM must satisfy. All fields are required; optional values are nullable
 * so strict JSON-schema providers accept it.
 */
export const SCHEMA_VERSION = 1 as const;

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

export const Improvement = z.object({
  title: Text(3, 80),
  detail: Text(10, 400),
  category: z.enum(IMPROVEMENT_CATEGORIES),
  priority: z.enum(["high", "medium", "low"]),
  evidenceQuote: Text(1, 160).nullable(),
  suggestedRewrite: Text(1, 300).nullable(),
});
export type Improvement = z.infer<typeof Improvement>;

export const Strength = z.object({ title: Text(3, 80), detail: Text(10, 300) });
export type Strength = z.infer<typeof Strength>;

export const PracticeDrill = z.object({
  title: Text(3, 80),
  instructions: Text(20, 500),
  durationMinutes: z.number().int().min(1).max(15),
});
export type PracticeDrill = z.infer<typeof PracticeDrill>;

export const CoachingFeedback = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  summary: Text(20, 400),
  clarity: z.object({ score: Score, rationale: Text(10, 300) }),
  structure: z.object({
    score: Score,
    hasClearOpening: z.boolean(),
    hasClearClosing: z.boolean(),
    rationale: Text(10, 300),
  }),
  audienceFit: z.object({
    score: Score,
    rationale: Text(10, 300),
    tips: z.array(Text(10, 200)).min(1).max(3),
  }),
  pacingInsight: Text(10, 300),
  fillerReview: z.object({
    confirmedCandidateIds: z.array(z.string().regex(/^c\d{1,3}$/)).max(150),
    note: Text(0, 200),
  }),
  strengths: z.array(Strength).min(1).max(3),
  improvements: z.array(Improvement).min(1).max(5),
  practiceDrill: PracticeDrill,
});
export type CoachingFeedback = z.infer<typeof CoachingFeedback>;

/**
 * What is persisted in `coaching_feedback.payload`. LLM output fits this
 * directly; rule-based feedback leaves the LLM-only judgments null.
 */
export interface StoredFeedback {
  schemaVersion: typeof SCHEMA_VERSION;
  summary: string;
  clarity: { score: number; rationale: string } | null;
  structure: { score: number; hasClearOpening: boolean; hasClearClosing: boolean; rationale: string } | null;
  audienceFit: { score: number | null; rationale: string | null; tips: string[] };
  pacingInsight: string;
  fillerReview: { confirmedCandidateIds: string[]; note: string } | null;
  strengths: Strength[];
  improvements: Improvement[];
  practiceDrill: PracticeDrill;
}
