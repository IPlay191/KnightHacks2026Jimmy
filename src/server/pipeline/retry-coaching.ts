import "server-only";
import { and, eq } from "drizzle-orm";
import { AppError } from "@/server/errors";
import { log } from "@/server/log";
import { NoSpeechError, prepareAnalysis } from "@/server/analysis/analyze";
import { getDb } from "@/server/db/client";
import { listChunks } from "@/server/db/queries/chunks";
import { completionBatch } from "@/server/db/queries/completion";
import { getOwnedSession } from "@/server/db/queries/sessions";
import { getUserSettings } from "@/server/db/queries/users";
import { coachingFeedback } from "@/server/db/schema";
import { chunkRowsToTranscripts, coachAndFinalize } from "./analyze-session";

/**
 * POST /coaching (design §9.5, R8.6): reruns the LLM for a complete session
 * whose feedback came from rules, using its stored audience and ASR output.
 */
export async function retryCoaching(
  userId: string,
  sessionId: string,
  deadline: number,
): Promise<{ feedbackSource: "llm" | "rules" }> {
  const session = await getOwnedSession(userId, sessionId);
  if (!session) throw new AppError("NOT_FOUND");
  if (session.status !== "complete") throw new AppError("CONFLICT_STATE");
  const db = getDb();
  const fb = await db
    .select({ source: coachingFeedback.source })
    .from(coachingFeedback)
    .where(and(eq(coachingFeedback.sessionId, sessionId)))
    .limit(1);
  if (fb[0]?.source !== "rules") throw new AppError("CONFLICT_STATE");

  const [rows, settings] = await Promise.all([listChunks(sessionId), getUserSettings(userId)]);
  const done = rows.filter((r) => r.status === "done");
  if (done.length === 0) throw new AppError("CONFLICT_STATE", { message: "This session can't be re-coached." });

  let prep;
  try {
    prep = prepareAnalysis(chunkRowsToTranscripts(done), settings, session.audience);
  } catch (err) {
    if (err instanceof NoSpeechError) throw new AppError("NO_SPEECH_DETECTED");
    throw err;
  }
  const { analysis, coach } = await coachAndFinalize(prep, session, deadline);
  if (analysis.source === "rules") {
    log.warn("coaching.retry_still_rules", { sessionId });
    return { feedbackSource: "rules" };
  }
  await db.batch(
    completionBatch(db, analysis, {
      sessionId,
      userId,
      modelId: coach.source === "llm" ? coach.model : null,
      attempts: coach.attempts,
      latencyMs: coach.latencyMs,
      asrModel: session.asrModel,
      markComplete: false,
      rewriteTranscript: true,
    }),
  );
  return { feedbackSource: "llm" };
}
