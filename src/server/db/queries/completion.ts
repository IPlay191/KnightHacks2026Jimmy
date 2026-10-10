import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "@/server/db/client";
import {
  coachingFeedback,
  practiceSessions,
  sessionMetrics,
  sessionScores,
  transcriptSegments,
  transcripts,
  transcriptWords,
} from "@/server/db/schema";
import { METRICS_VERSION } from "@/server/analysis/metrics";
import type { FinalAnalysis } from "@/server/analysis/analyze";
import { PROMPT_VERSION } from "@/server/hf/prompts";
import { SCHEMA_VERSION } from "@/lib/coaching";
import { recomputeStatsQuery } from "./stats";

export interface CompletionMeta {
  sessionId: string;
  userId: string;
  modelId: string | null;
  attempts: number;
  latencyMs: number | null;
  asrModel: string | null;
  /** When true, mark the session complete (analysis). False for coaching retry. */
  markComplete: boolean;
  completedAt?: Date;
  /** Only when re-scoring an already-complete session. */
  rewriteTranscript: boolean;
}

/** Builds rows for the derived tables. Shared with the seed script. */
export function derivedRows(a: FinalAnalysis, sessionId: string) {
  const segments = a.transcript.segments.map((s) => ({
    sessionId,
    seq: s.seq,
    startMs: s.startMs,
    endMs: s.endMs,
    text: s.text,
    wordCount: s.wordCount,
    timingSource: s.timingSource,
  }));
  const words = a.transcript.words.map((w) => {
    const filler = a.fillers.statusBySeq.get(w.seq);
    return {
      sessionId,
      seq: w.seq,
      segmentSeq: w.segmentSeq,
      word: w.word,
      startMs: w.startMs,
      endMs: w.endMs,
      timingSource: w.timingSource,
      fillerPhrase: filler?.phrase ?? null,
      fillerStatus: filler?.status ?? null,
    };
  });
  const m = a.metrics;
  const metrics = {
    sessionId,
    metricsVersion: METRICS_VERSION,
    durationMs: m.durationMs,
    speakingMs: m.speakingMs,
    wordCount: m.wordCount,
    wpm: Math.min(9999.9, m.wpm),
    articulationWpm: Math.min(9999.9, m.articulationWpm),
    wpmStddev: Math.min(9999.9, m.wpmStddev),
    pauseCount: m.pauseCount,
    longPauseCount: m.longPauseCount,
    longestPauseMs: m.longestPauseMs,
    pauseRatio: Math.min(1, m.pauseRatio),
    fillerCount: m.fillerCount,
    fillersPerMin: Math.min(999.99, m.fillersPerMin),
    fillerBreakdown: m.fillerBreakdown,
    wpmTimeline: m.wpmTimeline,
    pauses: m.pauses,
    readingGrade: a.readingGrade,
    targetWpmMin: a.profile.targetMin,
    targetWpmMax: a.profile.targetMax,
    targetGrade: a.profile.targetGrade,
  };
  const { readability: _r, ...scoreCols } = a.scores;
  const scores = { sessionId, ...scoreCols };
  return { segments, words, metrics, scores };
}

/**
 * The single completion batch (design §7.4, R14.6, R12.6): derived rows,
 * feedback, status = complete, and the stats recompute, all or nothing.
 * Steps are idempotent so a re-claimed stale run overwrites cleanly.
 */
export function completionBatch(db: Db, a: FinalAnalysis, meta: CompletionMeta) {
  const { segments, words, metrics, scores } = derivedRows(a, meta.sessionId);
  const now = new Date();
  const items: BatchItem<"pg">[] = [];

  if (meta.rewriteTranscript) {
    items.push(
      db.delete(transcriptWords).where(eq(transcriptWords.sessionId, meta.sessionId)),
      db.delete(transcriptSegments).where(eq(transcriptSegments.sessionId, meta.sessionId)),
      db
        .insert(transcripts)
        .values({
          sessionId: meta.sessionId,
          fullText: a.transcript.fullText,
          wordCount: a.transcript.wordCount,
          timingGranularity: a.transcript.timingGranularity,
        })
        .onConflictDoUpdate({
          target: transcripts.sessionId,
          set: {
            fullText: a.transcript.fullText,
            wordCount: a.transcript.wordCount,
            timingGranularity: a.transcript.timingGranularity,
          },
        }),
    );
    if (segments.length) items.push(db.insert(transcriptSegments).values(segments));
    if (words.length) items.push(db.insert(transcriptWords).values(words));
  } else {
    // Coaching retry: only filler statuses on existing words change.
    for (const w of words) {
      if (w.fillerStatus === null) continue;
      items.push(
        db
          .update(transcriptWords)
          .set({ fillerPhrase: w.fillerPhrase, fillerStatus: w.fillerStatus })
          .where(and(eq(transcriptWords.sessionId, meta.sessionId), eq(transcriptWords.seq, w.seq))),
      );
    }
  }

  const { sessionId: _m, ...metricsSet } = metrics;
  items.push(
    db.insert(sessionMetrics).values(metrics).onConflictDoUpdate({ target: sessionMetrics.sessionId, set: metricsSet }),
  );
  const { sessionId: _s, ...scoresSet } = scores;
  items.push(
    db.insert(sessionScores).values(scores).onConflictDoUpdate({ target: sessionScores.sessionId, set: scoresSet }),
  );
  const feedbackRow = {
    sessionId: meta.sessionId,
    source: a.source,
    modelId: meta.modelId,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    summary: a.feedback.summary.slice(0, 400),
    payload: a.feedback,
    attempts: Math.max(1, meta.attempts),
    latencyMs: meta.latencyMs,
    updatedAt: now,
  };
  const { sessionId: _f, ...feedbackSet } = feedbackRow;
  items.push(
    db
      .insert(coachingFeedback)
      .values(feedbackRow)
      .onConflictDoUpdate({ target: coachingFeedback.sessionId, set: feedbackSet }),
  );

  if (meta.markComplete) {
    items.push(
      db
        .update(practiceSessions)
        .set({
          status: "complete",
          stage: null,
          failedStage: null,
          errorCode: null,
          completedAt: meta.completedAt ?? now,
          asrModel: meta.asrModel ?? sql`${practiceSessions.asrModel}`,
          llmModel: meta.modelId,
          updatedAt: now,
        })
        .where(and(eq(practiceSessions.id, meta.sessionId), eq(practiceSessions.userId, meta.userId))),
    );
  } else {
    items.push(
      db
        .update(practiceSessions)
        .set({ llmModel: meta.modelId, updatedAt: now })
        .where(and(eq(practiceSessions.id, meta.sessionId), eq(practiceSessions.userId, meta.userId))),
    );
  }
  items.push(recomputeStatsQuery(db, meta.userId));
  return items as [BatchItem<"pg">, ...BatchItem<"pg">[]];
}
