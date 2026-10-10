import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Interval, TimedText } from "@/lib/types";
import { getDb } from "@/server/db/client";
import { audioChunks, practiceSessions, type ChunkRow } from "@/server/db/schema";

export async function getChunk(sessionId: string, index: number): Promise<ChunkRow | null> {
  const rows = await getDb()
    .select()
    .from(audioChunks)
    .where(and(eq(audioChunks.sessionId, sessionId), eq(audioChunks.chunkIndex, index)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listChunks(sessionId: string): Promise<ChunkRow[]> {
  return getDb()
    .select()
    .from(audioChunks)
    .where(eq(audioChunks.sessionId, sessionId))
    .orderBy(asc(audioChunks.chunkIndex));
}

/** Upserts the chunk as `transcribing` and bumps its attempt counter. */
export async function markChunkTranscribing(sessionId: string, index: number, startMs: number, endMs: number) {
  const now = new Date();
  await getDb()
    .insert(audioChunks)
    .values({ sessionId, chunkIndex: index, startMs, endMs, status: "transcribing", attempts: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [audioChunks.sessionId, audioChunks.chunkIndex],
      set: {
        startMs,
        endMs,
        status: "transcribing",
        attempts: sql`${audioChunks.attempts} + 1`,
        errorCode: null,
        updatedAt: now,
      },
    });
}

export async function markChunkFailed(sessionId: string, index: number, errorCode: string) {
  await getDb()
    .update(audioChunks)
    .set({ status: "failed", errorCode, updatedAt: new Date() })
    .where(and(eq(audioChunks.sessionId, sessionId), eq(audioChunks.chunkIndex, index)));
}

export interface ChunkDone {
  sessionId: string;
  index: number;
  startMs: number;
  endMs: number;
  voicedRatio: number;
  silences: Interval[];
  asrText: string;
  asrSegments: TimedText[] | null;
  asrWordLevel: boolean;
  asrModel: string;
  asrLatencyMs: number;
}

/**
 * Stores the finished chunk and advances the session (created/uploading →
 * uploading, or → transcribed when all expected chunks are done) in one batch.
 * Returns the resulting session status and done count.
 */
export async function completeChunk(c: ChunkDone): Promise<{ status: string; chunksDone: number }> {
  const db = getDb();
  const now = new Date();
  const [, updated, counted] = await db.batch([
    db
      .update(audioChunks)
      .set({
        status: "done",
        startMs: c.startMs,
        endMs: c.endMs,
        voicedRatio: c.voicedRatio,
        silences: c.silences,
        asrText: c.asrText,
        asrSegments: c.asrSegments,
        asrWordLevel: c.asrWordLevel,
        asrModel: c.asrModel,
        asrLatencyMs: c.asrLatencyMs,
        errorCode: null,
        updatedAt: now,
      })
      .where(and(eq(audioChunks.sessionId, c.sessionId), eq(audioChunks.chunkIndex, c.index))),
    db
      .update(practiceSessions)
      .set({
        status: sql`CASE WHEN (SELECT count(*) FROM audio_chunks a WHERE a.session_id = ${practiceSessions.id} AND a.status = 'done') >= ${practiceSessions.expectedChunks} THEN 'transcribed'::session_status ELSE 'uploading'::session_status END`,
        asrModel: c.asrModel === "skipped-silent" ? sql`${practiceSessions.asrModel}` : c.asrModel,
        updatedAt: now,
      })
      .where(and(eq(practiceSessions.id, c.sessionId), sql`${practiceSessions.status} IN ('created', 'uploading')`))
      .returning({ status: practiceSessions.status }),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(audioChunks)
      .where(and(eq(audioChunks.sessionId, c.sessionId), eq(audioChunks.status, "done"))),
  ]);
  return { status: updated[0]?.status ?? "uploading", chunksDone: counted[0]?.n ?? 0 };
}
