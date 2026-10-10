import "server-only";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import type { StoredFeedback } from "@/lib/coaching";
import type { Audience, AudienceFitSource, FeedbackSource, FillerBreakdown, Interval, TimelineWindow } from "@/lib/types";
import { getDb } from "@/server/db/client";
import {
  coachingFeedback,
  practiceSessions,
  sessionMetrics,
  sessionScores,
  transcriptSegments,
  transcriptWords,
} from "@/server/db/schema";

/** Serializable report payload for the dashboard (R10, R11, R20.7). */
export interface ReportData {
  session: {
    id: string;
    title: string | null;
    goal: string | null;
    audience: Audience;
    durationMs: number;
    completedAt: string;
    timeZone: string;
    isSample: boolean;
    videoCaptured: boolean;
    asrModel: string | null;
  };
  metrics: {
    wpm: number;
    articulationWpm: number;
    wpmStddev: number;
    speakingMs: number;
    wordCount: number;
    pauseCount: number;
    longPauseCount: number;
    longestPauseMs: number;
    pauseRatio: number;
    fillerCount: number;
    fillersPerMin: number;
    fillerBreakdown: FillerBreakdown;
    wpmTimeline: TimelineWindow[];
    pauses: Interval[];
    readingGrade: number;
    targetWpmMin: number;
    targetWpmMax: number;
    targetGrade: number;
    durationMs: number;
  };
  scores: {
    overall: number;
    pacing: number;
    fillers: number;
    pauses: number;
    clarity: number | null;
    structure: number | null;
    audienceFit: number;
    audienceFitSource: AudienceFitSource;
  };
  feedback: { source: FeedbackSource; modelId: string | null; payload: StoredFeedback };
  segments: { seq: number; startMs: number; endMs: number; text: string }[];
  words: {
    seq: number;
    segmentSeq: number;
    word: string;
    startMs: number;
    fillerPhrase: string | null;
    fillerStatus: string | null;
  }[];
  previous: {
    overall: number;
    pacing: number;
    fillers: number;
    pauses: number;
    clarity: number | null;
    audienceFit: number;
    wpm: number;
    fillersPerMin: number;
    longPauseCount: number;
    readingGrade: number;
  } | null;
}

export async function getSessionReport(userId: string, sessionId: string): Promise<ReportData | null> {
  const db = getDb();
  const rows = await db
    .select({ s: practiceSessions, m: sessionMetrics, sc: sessionScores, f: coachingFeedback })
    .from(practiceSessions)
    .innerJoin(sessionMetrics, eq(sessionMetrics.sessionId, practiceSessions.id))
    .innerJoin(sessionScores, eq(sessionScores.sessionId, practiceSessions.id))
    .innerJoin(coachingFeedback, eq(coachingFeedback.sessionId, practiceSessions.id))
    .where(
      and(
        eq(practiceSessions.id, sessionId),
        eq(practiceSessions.userId, userId),
        eq(practiceSessions.status, "complete"),
      ),
    )
    .limit(1);
  const row = rows[0];
  const completedAt = row?.s.completedAt;
  if (!row || !completedAt) return null;
  const { s, m, sc, f } = row;

  const [segments, words, prevRows] = await Promise.all([
    db
      .select({
        seq: transcriptSegments.seq,
        startMs: transcriptSegments.startMs,
        endMs: transcriptSegments.endMs,
        text: transcriptSegments.text,
      })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.sessionId, sessionId))
      .orderBy(asc(transcriptSegments.seq)),
    db
      .select({
        seq: transcriptWords.seq,
        segmentSeq: transcriptWords.segmentSeq,
        word: transcriptWords.word,
        startMs: transcriptWords.startMs,
        fillerPhrase: transcriptWords.fillerPhrase,
        fillerStatus: transcriptWords.fillerStatus,
      })
      .from(transcriptWords)
      .where(eq(transcriptWords.sessionId, sessionId))
      .orderBy(asc(transcriptWords.seq)),
    // Previous completed session with the same audience (R20.8).
    db
      .select({ sc: sessionScores, m: sessionMetrics })
      .from(practiceSessions)
      .innerJoin(sessionScores, eq(sessionScores.sessionId, practiceSessions.id))
      .innerJoin(sessionMetrics, eq(sessionMetrics.sessionId, practiceSessions.id))
      .where(
        and(
          eq(practiceSessions.userId, userId),
          eq(practiceSessions.status, "complete"),
          eq(practiceSessions.audience, s.audience),
          lt(practiceSessions.completedAt, completedAt),
        ),
      )
      .orderBy(desc(practiceSessions.completedAt))
      .limit(1),
  ]);
  const prev = prevRows[0];

  return {
    session: {
      id: s.id,
      title: s.title,
      goal: s.goal,
      audience: s.audience,
      durationMs: s.durationMs,
      completedAt: completedAt.toISOString(),
      timeZone: s.timeZone,
      isSample: s.isSample,
      videoCaptured: s.videoCaptured,
      asrModel: s.asrModel,
    },
    metrics: {
      wpm: m.wpm,
      articulationWpm: m.articulationWpm,
      wpmStddev: m.wpmStddev,
      speakingMs: m.speakingMs,
      wordCount: m.wordCount,
      pauseCount: m.pauseCount,
      longPauseCount: m.longPauseCount,
      longestPauseMs: m.longestPauseMs,
      pauseRatio: m.pauseRatio,
      fillerCount: m.fillerCount,
      fillersPerMin: m.fillersPerMin,
      fillerBreakdown: m.fillerBreakdown,
      wpmTimeline: m.wpmTimeline,
      pauses: m.pauses,
      readingGrade: m.readingGrade,
      targetWpmMin: m.targetWpmMin,
      targetWpmMax: m.targetWpmMax,
      targetGrade: m.targetGrade,
      durationMs: m.durationMs,
    },
    scores: {
      overall: sc.overall,
      pacing: sc.pacing,
      fillers: sc.fillers,
      pauses: sc.pauses,
      clarity: sc.clarity,
      structure: sc.structure,
      audienceFit: sc.audienceFit,
      audienceFitSource: sc.audienceFitSource,
    },
    feedback: { source: f.source, modelId: f.modelId, payload: f.payload },
    segments,
    words,
    previous: prev
      ? {
          overall: prev.sc.overall,
          pacing: prev.sc.pacing,
          fillers: prev.sc.fillers,
          pauses: prev.sc.pauses,
          clarity: prev.sc.clarity,
          audienceFit: prev.sc.audienceFit,
          wpm: prev.m.wpm,
          fillersPerMin: prev.m.fillersPerMin,
          longPauseCount: prev.m.longPauseCount,
          readingGrade: prev.m.readingGrade,
        }
      : null,
  };
}

/** Lightweight lookup used by the processing page to know if a report exists. */
export async function sessionExistsForUser(userId: string, sessionId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ n: sql<number>`1` })
    .from(practiceSessions)
    .where(and(eq(practiceSessions.id, sessionId), eq(practiceSessions.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
