import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";

/**
 * Recomputes `user_stats` from the user's completed sessions (design §7.4).
 * Returns a batchable query so it can run in the same transaction as the
 * write that changed the sessions (R12.6, R13.7).
 */
export function recomputeStatsQuery(db: Db, userId: string) {
  return db.execute(sql`
    INSERT INTO user_stats (user_id, completed_sessions, total_speaking_ms, best_overall_score, last_session_at, updated_at)
    SELECT ${userId}::uuid,
           count(s.id)::int,
           coalesce(sum(m.speaking_ms), 0)::bigint,
           max(sc.overall),
           max(s.completed_at),
           now()
    FROM (SELECT 1) AS one
    LEFT JOIN practice_sessions s ON s.user_id = ${userId}::uuid AND s.status = 'complete'
    LEFT JOIN session_metrics m ON m.session_id = s.id
    LEFT JOIN session_scores sc ON sc.session_id = s.id
    ON CONFLICT (user_id) DO UPDATE SET
      completed_sessions = EXCLUDED.completed_sessions,
      total_speaking_ms = EXCLUDED.total_speaking_ms,
      best_overall_score = EXCLUDED.best_overall_score,
      last_session_at = EXCLUDED.last_session_at,
      updated_at = now()
  `);
}
