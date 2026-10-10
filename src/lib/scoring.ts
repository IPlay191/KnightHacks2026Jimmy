/**
 * Scoring formulas (design §6.5, R7.6, R20.4–20.6). Pure; shared with the UI
 * for labels. All scores are integers in 0–100.
 */
export const SCORING_VERSION = 1;

export const WEIGHTS = {
  pacing: 0.2,
  fillers: 0.2,
  pauses: 0.15,
  clarity: 0.15,
  structure: 0.15,
  audienceFit: 0.15,
} as const;
export type ScoreComponent = keyof typeof WEIGHTS;

export const clampScore = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;

export function pacingScore(wpm: number, stddev: number, targetMin: number, targetMax: number): number {
  const distance = wpm < targetMin ? targetMin - wpm : wpm > targetMax ? wpm - targetMax : 0;
  const base = 100 - 2.5 * distance;
  const variabilityPenalty = Math.max(0, Math.min(20, stddev - 25));
  return clampScore(base - variabilityPenalty);
}

export function fillersScore(fillersPerMin: number): number {
  return clampScore(100 - 12.5 * fillersPerMin);
}

export function pausesScore(longPausesPerMin: number, tolerancePerMin: number): number {
  return clampScore(100 - 25 * Math.max(0, longPausesPerMin - tolerancePerMin));
}

export function audienceFitScore(readability: number, llmAudienceFit: number | null): number {
  if (llmAudienceFit === null) return clampScore(readability);
  return clampScore(0.4 * readability + 0.6 * llmAudienceFit);
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

export function scoreLabel(score: number): "Excellent" | "Strong" | "Developing" | "Needs work" {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Strong";
  if (score >= 55) return "Developing";
  return "Needs work";
}
