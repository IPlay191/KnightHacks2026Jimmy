import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Audience } from "@/lib/types";
import { getDb } from "@/server/db/client";
import { practiceSessions, sessionMetrics, sessionScores, userStats } from "@/server/db/schema";

export const PAGE_SIZE = 20;
const SERIES_LIMIT = 50;

export interface HistoryPoint {
  id: string;
  title: string | null;
  audience: Audience;
  completedAt: string;
  timeZone: string;
  durationMs: number;
  speakingMs: number;
  isSample: boolean;
  overall: number;
  pacing: number;
  fillers: number;
  pauses: number;
  clarity: number | null;
  audienceFit: number;
}

function completedFor(userId: string, audience: Audience | null): SQL {
  const base = and(eq(practiceSessions.userId, userId), eq(practiceSessions.status, "complete"));
  return (audience ? and(base, eq(practiceSessions.audience, audience)) : base) as SQL;
}

const pointColumns = {
  id: practiceSessions.id,
  title: practiceSessions.title,
  audience: practiceSessions.audience,
  completedAt: practiceSessions.completedAt,
  timeZone: practiceSessions.timeZone,
  durationMs: practiceSessions.durationMs,
  speakingMs: sessionMetrics.speakingMs,
  isSample: practiceSessions.isSample,
  overall: sessionScores.overall,
  pacing: sessionScores.pacing,
  fillers: sessionScores.fillers,
  pauses: sessionScores.pauses,
  clarity: sessionScores.clarity,
  audienceFit: sessionScores.audienceFit,
};

type RawPoint = { [K in keyof typeof pointColumns]: unknown } & { completedAt: Date | null };

function toPoint(r: RawPoint): HistoryPoint {
  return { ...(r as unknown as HistoryPoint), completedAt: (r.completedAt ?? new Date(0)).toISOString() };
}

export async function listHistoryPage(
  userId: string,
  page: number,
  audience: Audience | null,
): Promise<{ items: HistoryPoint[]; total: number }> {
  const db = getDb();
  const where = completedFor(userId, audience);
  const [rows, totalRows] = await Promise.all([
    db
      .select(pointColumns)
      .from(practiceSessions)
      .innerJoin(sessionScores, eq(sessionScores.sessionId, practiceSessions.id))
      .innerJoin(sessionMetrics, eq(sessionMetrics.sessionId, practiceSessions.id))
      .where(where)
      .orderBy(desc(practiceSessions.completedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(practiceSessions)
      .innerJoin(sessionScores, eq(sessionScores.sessionId, practiceSessions.id))
      .where(where),
  ]);
  return { items: rows.map((r) => toPoint(r as RawPoint)), total: totalRows[0]?.n ?? 0 };
}

/** The last 50 completed sessions, oldest first, for charts, streak, and trend. */
export async function listProgressSeries(userId: string, audience: Audience | null): Promise<HistoryPoint[]> {
  const rows = await getDb()
    .select(pointColumns)
    .from(practiceSessions)
    .innerJoin(sessionScores, eq(sessionScores.sessionId, practiceSessions.id))
    .innerJoin(sessionMetrics, eq(sessionMetrics.sessionId, practiceSessions.id))
    .where(completedFor(userId, audience))
    .orderBy(desc(practiceSessions.completedAt))
    .limit(SERIES_LIMIT);
  return rows.map((r) => toPoint(r as RawPoint)).reverse();
}

export interface StatsSummary {
  completedSessions: number;
  totalSpeakingMs: number;
  bestOverallScore: number | null;
}

export async function getStatsSummary(userId: string): Promise<StatsSummary> {
  const rows = await getDb()
    .select({
      completedSessions: userStats.completedSessions,
      totalSpeakingMs: userStats.totalSpeakingMs,
      bestOverallScore: userStats.bestOverallScore,
    })
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1);
  return rows[0] ?? { completedSessions: 0, totalSpeakingMs: 0, bestOverallScore: null };
}
