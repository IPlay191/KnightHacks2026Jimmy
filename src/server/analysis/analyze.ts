import type { ContentVerdict, StoredFeedback } from "@/lib/coaching";
import { resolveAudienceProfile, type ResolvedProfile } from "@/lib/audience";
import {
  audienceFitScore,
  computeOverall,
  fillersScore,
  pacingScore,
  pausesScore,
  SCORING_VERSION,
  type SubstanceSignals,
} from "@/lib/scoring";
import type { Audience, AudienceFitSource, FeedbackSource } from "@/lib/types";
import { detectFillers, resolveFillers, type FillerDetection, type FillerResolution } from "./fillers";
import { computeMetrics, type DeliveryMetrics } from "./metrics";
import { readabilityScore, readingGrade } from "./readability";
import { buildRulesFeedback } from "./rules-feedback";
import { lexicalDiversity, repetitionRatio } from "./substance";
import { assembleTranscript, type AssembledTranscript, type ChunkTranscript } from "./transcript";

/**
 * Pure analysis core shared by the analyze route, retry coaching, and the
 * seed script. No I/O. Split into prepare (before the LLM) and finalize
 * (after the LLM or rules).
 */
export const MIN_WORDS = 15;

export class NoSpeechError extends Error {
  constructor() {
    super("not enough speech");
    this.name = "NoSpeechError";
  }
}

export interface AnalysisSettings {
  targetWpmMin: number;
  targetWpmMax: number;
  customFillers: string[];
}

export interface PreparedAnalysis {
  transcript: AssembledTranscript;
  detection: FillerDetection;
  profile: ResolvedProfile;
  durationMs: number;
  readingGrade: number;
  /** Metrics with unambiguous fillers only (what the LLM sees). */
  preliminary: DeliveryMetrics;
  silences: ChunkTranscript["silences"];
  substance: SubstanceSignals;
}

export function prepareAnalysis(
  chunks: ChunkTranscript[],
  settings: AnalysisSettings,
  audience: Audience,
): PreparedAnalysis {
  const transcript = assembleTranscript(chunks);
  if (transcript.wordCount < MIN_WORDS) throw new NoSpeechError();
  const durationMs = chunks.reduce((a, c) => a + (c.endMs - c.startMs), 0);
  const silences = chunks.flatMap((c) => c.silences);
  const detection = detectFillers(transcript.words, settings.customFillers);
  const unambiguousOnly = resolveFillers(detection, null);
  const preliminary = computeMetrics({
    durationMs,
    words: transcript.words,
    silences,
    fillerCount: unambiguousOnly.count,
    fillerBreakdown: unambiguousOnly.breakdown,
  });
  const profile = resolveAudienceProfile(audience, settings);
  const grade = readingGrade({ segments: transcript.segments.map((s) => s.text) });
  const norms = transcript.words.map((w) => w.norm);
  const substance: SubstanceSignals = {
    wordCount: transcript.wordCount,
    activeMs: preliminary.activeMs,
    lexicalDiversity: lexicalDiversity(norms),
    repetitionRatio: repetitionRatio(norms),
  };
  return { transcript, detection, profile, durationMs, readingGrade: grade, preliminary, silences, substance };
}

/** Numbers the LLM is allowed to cite (never recomputed by it, R8.8). */
export function metricsForPrompt(prep: PreparedAnalysis): Record<string, number | string> {
  const m = prep.preliminary;
  return {
    duration_sec: Math.round(m.durationMs / 1000),
    word_count: m.wordCount,
    wpm: m.wpm,
    articulation_wpm: m.articulationWpm,
    wpm_stddev: m.wpmStddev,
    pause_count: m.pauseCount,
    long_pause_count: m.longPauseCount,
    longest_pause_sec: Math.round(m.longestPauseMs / 100) / 10,
    unambiguous_filler_count: m.fillerCount,
    reading_grade: prep.readingGrade,
    lexical_diversity: prep.substance.lexicalDiversity,
    repeated_phrase_ratio: prep.substance.repetitionRatio,
    target_wpm: `${prep.profile.targetMin}-${prep.profile.targetMax}`,
  };
}

export interface LlmOutcome {
  source: FeedbackSource;
  /** Present when source = llm. */
  feedback?: StoredFeedback & {
    fillerReview: { confirmedCandidateIds: string[]; note: string };
    contentVerdict?: ContentVerdict | null;
  };
  /** Why AI coaching was unavailable (source = rules). */
  reason?: string;
}

export interface FinalAnalysis {
  transcript: AssembledTranscript;
  metrics: DeliveryMetrics;
  fillers: FillerResolution;
  readingGrade: number;
  profile: ResolvedProfile;
  scores: {
    scoringVersion: number;
    overall: number;
    pacing: number;
    fillers: number;
    pauses: number;
    clarity: number | null;
    structure: number | null;
    audienceFit: number;
    audienceFitSource: AudienceFitSource;
    readability: number;
  };
  feedback: StoredFeedback;
  source: FeedbackSource;
}

export function finalizeAnalysis(prep: PreparedAnalysis, outcome: LlmOutcome): FinalAnalysis {
  const llm = outcome.source === "llm" && outcome.feedback ? outcome.feedback : null;
  const fillers = resolveFillers(prep.detection, llm ? llm.fillerReview.confirmedCandidateIds : null);
  const metrics = computeMetrics({
    durationMs: prep.durationMs,
    words: prep.transcript.words,
    silences: prep.silences,
    fillerCount: fillers.count,
    fillerBreakdown: fillers.breakdown,
  });
  const p = prep.profile;
  const minutes = (metrics.activeMs > 0 ? metrics.activeMs : metrics.durationMs) / 60000;
  const longPausesPerMin = minutes > 0 ? metrics.longPauseCount / minutes : 0;
  const pacing = pacingScore(metrics.wpm, metrics.wpmStddev, p.targetMin, p.targetMax);
  const fillersS = fillersScore(metrics.fillersPerMin);
  const pauses = pausesScore(longPausesPerMin, p.longPauseTolerance);
  const readability = readabilityScore(prep.readingGrade, p.targetGrade);
  const clarity = llm?.clarity?.score ?? null;
  const structure = llm?.structure?.score ?? null;
  const llmFit = llm?.audienceFit.score ?? null;
  const audienceFit = audienceFitScore(readability, llmFit);
  const verdict: ContentVerdict | null = llm ? (llm.contentVerdict ?? "adequate") : null;
  const result = computeOverall({
    components: { pacing, fillers: fillersS, pauses, clarity, structure, audienceFit },
    verdict,
    substance: { ...prep.substance, activeMs: metrics.activeMs },
  });

  const base: StoredFeedback =
    llm ??
    buildRulesFeedback({
      wpm: metrics.wpm,
      fillersPerMin: metrics.fillersPerMin,
      longPausesPerMin,
      readingGrade: prep.readingGrade,
      scores: { pacing, fillers: fillersS, pauses, readability },
      profile: p,
      reason: outcome.reason ?? null,
    });
  const feedback: StoredFeedback = {
    ...base,
    scoreCap: result.cap !== null ? { cap: result.cap, weighted: result.weighted, reason: result.capReason ?? "" } : null,
  };

  return {
    transcript: prep.transcript,
    metrics,
    fillers,
    readingGrade: prep.readingGrade,
    profile: p,
    scores: {
      scoringVersion: SCORING_VERSION,
      overall: result.overall,
      pacing,
      fillers: fillersS,
      pauses,
      clarity,
      structure,
      audienceFit,
      audienceFitSource: llmFit === null ? "readability_only" : "combined",
      readability,
    },
    feedback,
    source: llm ? "llm" : "rules",
  };
}
