import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Audience, PipelineStage, SessionStatus } from "@/lib/types";
import { getDb } from "@/server/db/client";
import { audioChunks, practiceSessions } from "@/server/db/schema";
import { recomputeStatsQuery } from "./stats";

export interface NewSession {
  userId: string;
  title: string | null;
  goal: string | null;
  durationMs: number;
  expectedChunks: number;
  videoCaptured: boolean;
  timeZone: string;
  audience: Audience;
  audienceProfileVersion: number;
}

export async function insertSession(s: NewSession): Promise<string> {
  const rows = await getDb()
    .insert(practiceSessions)
    .values({ ...s, status: "created" })
    .returning({ id: practiceSessions.id });
  const id = rows[0]?.id;
  if (!id) throw new Error("insert returned no id");
  return id;
}

export async function countRecentSessions(userId: string, since: Date): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.userId, userId),
        eq(practiceSessions.isSample, false),
        gte(practiceSessions.createdAt, since),
      ),
    );
  return rows[0]?.n ?? 0;
}

export async function getOwnedSession(userId: string, sessionId: string) {
  const rows = await getDb()
    .select()
    .from(practiceSessions)
    .where(and(eq(practiceSessions.id, sessionId), eq(practiceSessions.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface SessionStatusView {
  status: SessionStatus;
  stage: PipelineStage | null;
  failedStage: PipelineStage | null;
  errorCode: string | null;
  chunksDone: number;
  chunksExpected: number;
  missingChunks: number[];
  updatedAt: Date;
  analysisAttempts: number;
}

export async function getStatusView(userId: string, sessionId: string): Promise<SessionStatusView | null> {
  const db = getDb();
  const session = await getOwnedSession(userId, sessionId);
  if (!session) return null;
  const chunks = await db
    .select({ index: audioChunks.chunkIndex, status: audioChunks.status })
    .from(audioChunks)
    .where(eq(audioChunks.sessionId, sessionId));
  const done = new Set(chunks.filter((c) => c.status === "done").map((c) => c.index));
  const missing: number[] = [];
  for (let i = 0; i < session.expectedChunks; i++) if (!done.has(i)) missing.push(i);
  return {
    status: session.status,
    stage: session.stage,
    failedStage: session.failedStage,
    errorCode: session.errorCode,
    chunksDone: done.size,
    chunksExpected: session.expectedChunks,
    missingChunks: missing,
    updatedAt: session.updatedAt,
    analysisAttempts: session.analysisAttempts,
  };
}

/**
 * Atomic analysis claim (design §3.2, R14.7, NFR-2.6, NFR-4.3). Also accepts
 * created/uploading sessions whose chunks are all done, which covers the race
 * where two final chunks finish concurrently.
 */
export async function claimAnalysis(userId: string, sessionId: string): Promise<boolean> {
  const t = practiceSessions;
  const rows = await getDb()
    .update(t)
    .set({
      status: "analyzing",
      stage: "metrics",
      failedStage: null,
      errorCode: null,
      analysisAttempts: sql`${t.analysisAttempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(t.id, sessionId),
        eq(t.userId, userId),
        sql`${t.analysisAttempts} < 3`,
        sql`(
          ${t.status} = 'transcribed'
          OR (${t.status} IN ('created', 'uploading') AND
              (SELECT count(*) FROM audio_chunks c WHERE c.session_id = ${t.id} AND c.status = 'done') >= ${t.expectedChunks})
          OR (${t.status} = 'failed' AND ${t.failedStage} IN ('metrics', 'coaching', 'saving'))
          OR (${t.status} = 'analyzing' AND ${t.updatedAt} < now() - interval '2 minutes')
        )`,
      ),
    )
    .returning({ id: t.id });
  return rows.length > 0;
}

export async function setStage(userId: string, sessionId: string, stage: PipelineStage): Promise<void> {
  await getDb()
    .update(practiceSessions)
    .set({ stage, updatedAt: new Date() })
    .where(
      and(
        eq(practiceSessions.id, sessionId),
        eq(practiceSessions.userId, userId),
        eq(practiceSessions.status, "analyzing"),
      ),
    );
}

export async function markFailed(
  userId: string,
  sessionId: string,
  failedStage: PipelineStage,
  errorCode: string,
): Promise<void> {
  await getDb()
    .update(practiceSessions)
    .set({ status: "failed", stage: null, failedStage, errorCode, updatedAt: new Date() })
    .where(
      and(
        eq(practiceSessions.id, sessionId),
        eq(practiceSessions.userId, userId),
        eq(practiceSessions.status, "analyzing"),
      ),
    );
}

/** Deletes one session (cascade) and recomputes stats in the same batch (R13.7). */
export async function deleteSession(userId: string, sessionId: string): Promise<boolean> {
  const db = getDb();
  const [deleted] = await db.batch([
    db
      .delete(practiceSessions)
      .where(and(eq(practiceSessions.id, sessionId), eq(practiceSessions.userId, userId)))
      .returning({ id: practiceSessions.id }),
    recomputeStatsQuery(db, userId),
  ]);
  return deleted.length > 0;
}

/** Removes every sample session and recomputes stats in one batch (R13.5, R13.7). */
export async function deleteSampleSessions(userId: string): Promise<number> {
  const db = getDb();
  const [deleted] = await db.batch([
    db
      .delete(practiceSessions)
      .where(and(eq(practiceSessions.userId, userId), eq(practiceSessions.isSample, true)))
      .returning({ id: practiceSessions.id }),
    recomputeStatsQuery(db, userId),
  ]);
  return deleted.length;
}

export async function hasSampleSessions(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: practiceSessions.id })
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.userId, userId),
        eq(practiceSessions.isSample, true),
        eq(practiceSessions.status, "complete"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function newestSampleSessionId(userId: string): Promise<string | null> {
  const rows = await getDb()
    .select({ id: practiceSessions.id })
    .from(practiceSessions)
    .where(
      and(
        eq(practiceSessions.userId, userId),
        eq(practiceSessions.isSample, true),
        eq(practiceSessions.status, "complete"),
      ),
    )
    .orderBy(sql`${practiceSessions.completedAt} DESC`)
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function sessionIdsByStatus(userId: string, statuses: SessionStatus[]) {
  return getDb()
    .select({ id: practiceSessions.id })
    .from(practiceSessions)
    .where(and(eq(practiceSessions.userId, userId), inArray(practiceSessions.status, statuses)));
}
