import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/server/db/client";
import {
  coachingFeedback,
  practiceSessions,
  sessionMetrics,
  sessionScores,
  transcriptSegments,
  transcripts,
  transcriptWords,
} from "@/server/db/schema";
import { recomputeStatsQuery } from "@/server/db/queries/stats";
import { findTemplateUserId } from "@/server/db/queries/users";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Copies the template user's sample sessions into a new guest (R1.3): new
 * UUIDs, dates shifted so the newest sample is yesterday, `is_sample = true`,
 * and stats recomputed in the same batch.
 */
export async function cloneSampleSessions(targetUserId: string): Promise<number> {
  const db = getDb();
  const templateId = await findTemplateUserId();
  if (!templateId) return 0;
  const sessions = await db
    .select()
    .from(practiceSessions)
    .where(and(eq(practiceSessions.userId, templateId), eq(practiceSessions.status, "complete")));
  if (sessions.length === 0) return 0;
  const ids = sessions.map((s) => s.id);
  const [tx, segs, words, metrics, scores, feedback] = await Promise.all([
    db.select().from(transcripts).where(inArray(transcripts.sessionId, ids)),
    db.select().from(transcriptSegments).where(inArray(transcriptSegments.sessionId, ids)),
    db.select().from(transcriptWords).where(inArray(transcriptWords.sessionId, ids)),
    db.select().from(sessionMetrics).where(inArray(sessionMetrics.sessionId, ids)),
    db.select().from(sessionScores).where(inArray(sessionScores.sessionId, ids)),
    db.select().from(coachingFeedback).where(inArray(coachingFeedback.sessionId, ids)),
  ]);

  const newest = Math.max(...sessions.map((s) => (s.completedAt ?? s.createdAt).getTime()));
  const yesterday = Date.now() - DAY_MS;
  const shift = yesterday - newest;
  const idMap = new Map(sessions.map((s) => [s.id, crypto.randomUUID()]));
  const shifted = (d: Date | null) => (d ? new Date(d.getTime() + shift) : null);
  const mapId = (id: string) => idMap.get(id) ?? id;

  const items: BatchItem<"pg">[] = [];
  items.push(
    db.insert(practiceSessions).values(
      sessions.map((s) => ({
        ...s,
        id: mapId(s.id),
        userId: targetUserId,
        isSample: true,
        createdAt: shifted(s.createdAt) ?? new Date(),
        updatedAt: shifted(s.updatedAt) ?? new Date(),
        completedAt: shifted(s.completedAt),
      })),
    ),
  );
  if (tx.length) items.push(db.insert(transcripts).values(tx.map((r) => ({ ...r, sessionId: mapId(r.sessionId) }))));
  if (segs.length) {
    items.push(db.insert(transcriptSegments).values(segs.map((r) => ({ ...r, sessionId: mapId(r.sessionId) }))));
  }
  if (words.length) {
    // Insert words in slices to keep each statement small.
    for (let i = 0; i < words.length; i += 1000) {
      items.push(
        db.insert(transcriptWords).values(words.slice(i, i + 1000).map((r) => ({ ...r, sessionId: mapId(r.sessionId) }))),
      );
    }
  }
  if (metrics.length) {
    items.push(db.insert(sessionMetrics).values(metrics.map((r) => ({ ...r, sessionId: mapId(r.sessionId) }))));
  }
  if (scores.length) {
    items.push(db.insert(sessionScores).values(scores.map((r) => ({ ...r, sessionId: mapId(r.sessionId) }))));
  }
  if (feedback.length) {
    items.push(db.insert(coachingFeedback).values(feedback.map((r) => ({ ...r, sessionId: mapId(r.sessionId) }))));
  }
  items.push(recomputeStatsQuery(db, targetUserId));
  await db.batch(items as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
  return sessions.length;
}
