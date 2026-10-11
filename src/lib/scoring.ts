/**
 * Scoring (design §6.5, R7.6, R20.4–20.6). Pure; shared with the UI for
 * labels. All scores are integers in 0–100.
 *
 * v2 is deliberately strict: content (clarity, structure, audience fit)
 * carries 60% of the weight, delivery formulas are steeper, and hard caps
 * stop a fluent-sounding but incoherent, repetitive, very short, or
 * unreviewed speech from scoring well.
 */
import type { ContentVerdict } from "./coaching";

export const SCORING_VERSION = 2;

export const WEIGHTS = {
  clarity: 0.25,
  structure: 0.2,
  audienceFit: 0.15,
  pacing: 0.15,
  fillers: 0.15,
  pauses: 0.1,
} as const;
export type ScoreComponent = keyof typeof WEIGHTS;

export const clampScore = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;

/** −3 per WPM outside the band (≈33 WPM off → 0), minus a penalty for erratic pace. */
export function pacingScore(wpm: number, stddev: number, targetMin: number, targetMax: number): number {
  const distance = wpm < targetMin ? targetMin - wpm : wpm > targetMax ? wpm - targetMax : 0;
  const base = 100 - 3 * distance;
  const variabilityPenalty = Math.max(0, Math.min(25, stddev - 18));
  return clampScore(base - variabilityPenalty);
}

/** −15 per filler per minute (2/min → 70, ~6.7/min → 0). */
export function fillersScore(fillersPerMin: number): number {
  return clampScore(100 - 15 * fillersPerMin);
}

/** −30 per long pause per minute above the audience's tolerance. */
export function pausesScore(longPausesPerMin: number, tolerancePerMin: number): number {
  return clampScore(100 - 30 * Math.max(0, longPausesPerMin - tolerancePerMin));
}

/** Readability is a minor signal; the model's judgment of audience fit dominates. */
export function audienceFitScore(readability: number, llmAudienceFit: number | null): number {
  if (llmAudienceFit === null) return clampScore(readability);
  return clampScore(0.3 * readability + 0.7 * llmAudienceFit);
}

export type ScoreInputs = Record<ScoreComponent, number | null>;

/** Weighted average over non-null components; weights renormalize (R7.6). */
export function overallScore(components: ScoreInputs): number {
  let num = 0;
  let den = 0;
  for (const key of Object.keys(WEIGHTS) as ScoreComponent[]) {
    const v = components[key];
    if (v === null || v === undefined) continue;
    num += WEIGHTS[key] * v;
    den += WEIGHTS[key];
  }
  return den > 0 ? clampScore(num / den) : 0;
}

/** Highest overall score allowed for each AI content verdict. */
export const VERDICT_CAPS: Record<ContentVerdict, number> = {
  incoherent: 30,
  weak: 55,
  adequate: 75,
  strong: 90,
  excellent: 100,
};

/** Cap when AI coaching was unavailable: content wasn't judged, so delivery alone can't earn a high score. */
export const UNREVIEWED_CAP = 60;

export interface SubstanceSignals {
  wordCount: number;
  /** Speaking span used for rates, in ms. */
  activeMs: number;
  /** Moving-average type-token ratio, 0–1 (≈0.55–0.75 for normal speech). */
  lexicalDiversity: number;
  /** Share of word trigrams that repeat an earlier trigram, 0–1. */
  repetitionRatio: number;
}

export interface OverallInput {
  components: ScoreInputs;
  /** null when AI coaching was unavailable. */
  verdict: ContentVerdict | null;
  substance: SubstanceSignals;
}

export interface OverallResult {
  overall: number;
  /** Weighted score before caps. */
  weighted: number;
  cap: number | null;
  capReason: string | null;
}

/**
 * Weighted score with hard caps. The lowest applicable cap wins, and its
 * reason is shown on the report so the score is explainable.
 */
export function computeOverall(input: OverallInput): OverallResult {
  const weighted = overallScore(input.components);
  const caps: { cap: number; reason: string }[] = [];
  const { substance: s, verdict, components: c } = input;

  if (verdict === null) {
    caps.push({ cap: UNREVIEWED_CAP, reason: "AI content review was unavailable, so this is a delivery-only score." });
  } else {
    caps.push({ cap: VERDICT_CAPS[verdict], reason: `The coach rated the content as ${verdict}.` });
    const content = [c.clarity, c.structure].filter((v): v is number => v !== null);
    if (content.length) {
      caps.push({
        cap: Math.min(...content) + 20,
        reason: "Your overall score can't run far ahead of your weakest content score (clarity or structure).",
      });
    }
  }
  if (s.wordCount < 40) caps.push({ cap: 40, reason: "There wasn't enough speech to judge." });
  else if (s.activeMs < 30_000) caps.push({ cap: 70, reason: "Speeches under 30 seconds are capped at 70." });
  if (s.wordCount >= 40 && (s.lexicalDiversity < 0.35 || s.repetitionRatio > 0.35)) {
    caps.push({ cap: 45, reason: "Large parts of the speech repeat the same words or phrases." });
  }
  const available = (Object.keys(WEIGHTS) as ScoreComponent[])
    .map((k) => c[k])
    .filter((v): v is number => v !== null);
  if (available.some((v) => v < 90)) {
    caps.push({ cap: 94, reason: "Scores of 95+ require every category to be at 90 or above." });
  }

  const binding = caps.reduce<{ cap: number; reason: string } | null>(
    (lowest, cur) => (cur.cap < weighted && (!lowest || cur.cap < lowest.cap) ? cur : lowest),
    null,
  );
  return {
    overall: binding ? clampScore(binding.cap) : weighted,
    weighted,
    cap: binding ? clampScore(binding.cap) : null,
    capReason: binding?.reason ?? null,
  };
}

export function scoreLabel(score: number): "Excellent" | "Strong" | "Developing" | "Needs work" {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Developing";
  return "Needs work";
}
