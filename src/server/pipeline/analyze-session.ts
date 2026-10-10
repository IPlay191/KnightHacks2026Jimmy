import "server-only";
import type { StoredFeedback } from "@/lib/coaching";
import { AppError } from "@/server/errors";
import { log } from "@/server/log";
import {
  finalizeAnalysis,
  metricsForPrompt,
  NoSpeechError,
  prepareAnalysis,
  type FinalAnalysis,
  type PreparedAnalysis,
} from "@/server/analysis/analyze";
import type { ChunkTranscript } from "@/server/analysis/transcript";
import { getDb } from "@/server/db/client";
import { listChunks } from "@/server/db/queries/chunks";
import { completionBatch } from "@/server/db/queries/completion";
import { claimAnalysis, getOwnedSession, getStatusView, markFailed, setStage } from "@/server/db/queries/sessions";
import { getUserSettings } from "@/server/db/queries/users";
import { generateCoaching, type CoachResult } from "@/server/hf/coach";
import type { ChunkRow, SessionRow } from "@/server/db/schema";

export function chunkRowsToTranscripts(rows: ChunkRow[]): ChunkTranscript[] {
  return rows.map((r) => ({
    index: r.chunkIndex,
    startMs: r.startMs,
    endMs: r.endMs,
    text: r.asrText ?? "",
    segments: r.asrSegments ?? null,
    wordLevel: r.asrWordLevel,
    silences: r.silences ?? [],
  }));
}

/** Runs the coaching step and turns its outcome into a final analysis. */
export async function coachAndFinalize(
  prep: PreparedAnalysis,
  session: Pick<SessionRow, "title" | "goal">,
  deadline: number,
): Promise<{ analysis: FinalAnalysis; coach: CoachResult }> {
  const coach = await generateCoaching(
    {
      metrics: metricsForPrompt(prep),
      candidates: prep.detection.candidates,
      title: session.title,
      goal: session.goal,
      profile: prep.profile,
      segments: prep.transcript.segments,
      transcriptText: prep.transcript.fullText,
      mockFail: (session.title ?? "").includes("[mock-llm-fail]"),
    },
    { deadline },
  );
  const analysis = finalizeAnalysis(
    prep,
    coach.source === "llm"
      ? { source: "llm", feedback: coach.feedback as StoredFeedback & { fillerReview: { confirmedCandidateIds: string[]; note: string } } }
      : { source: "rules" },
  );
  return { analysis, coach };
}

/**
 * POST /analyze orchestration (design §9.3): claim → metrics → coaching →
 * saving (one batch). LLM failure never fails the session (R8.6).
 */
export async function analyzeSession(
  userId: string,
  sessionId: string,
  deadline: number,
): Promise<{ status: "complete"; feedbackSource: "llm" | "rules" }> {
  const claimed = await claimAnalysis(userId, sessionId);
  if (!claimed) {
    const view = await getStatusView(userId, sessionId);
    if (!view) throw new AppError("NOT_FOUND");
    if (view.status === "complete") {
      return { status: "complete", feedbackSource: "llm" };
    }
    if (view.status === "analyzing") throw new AppError("ANALYSIS_IN_PROGRESS", { retryAfterSec: 2 });
    if (view.analysisAttempts >= 3) throw new AppError("ANALYSIS_LIMIT");
    if (view.status === "failed" && view.errorCode === "NO_SPEECH_DETECTED") throw new AppError("NO_SPEECH_DETECTED");
    throw new AppError("CHUNKS_INCOMPLETE", { missingChunks: view.missingChunks });
  }

  const session = await getOwnedSession(userId, sessionId);
  if (!session) throw new AppError("NOT_FOUND");

  let prep: PreparedAnalysis;
  try {
    const [rows, settings] = await Promise.all([listChunks(sessionId), getUserSettings(userId)]);
    const done = rows.filter((r) => r.status === "done");
    if (done.length < session.expectedChunks) {
      await markFailed(userId, sessionId, "metrics", "CHUNKS_INCOMPLETE");
      const have = new Set(done.map((r) => r.chunkIndex));
      const missing = Array.from({ length: session.expectedChunks }, (_, i) => i).filter((i) => !have.has(i));
      throw new AppError("CHUNKS_INCOMPLETE", { missingChunks: missing });
    }
    prep = prepareAnalysis(chunkRowsToTranscripts(done), settings, session.audience);
  } catch (err) {
    if (err instanceof NoSpeechError) {
      await markFailed(userId, sessionId, "metrics", "NO_SPEECH_DETECTED");
      throw new AppError("NO_SPEECH_DETECTED");
    }
    if (err instanceof AppError) throw err;
    await markFailed(userId, sessionId, "metrics", "INTERNAL").catch(() => undefined);
    throw err;
  }

  await setStage(userId, sessionId, "coaching");
  let analysis: FinalAnalysis;
  let coach: CoachResult;
  try {
    ({ analysis, coach } = await coachAndFinalize(prep, session, deadline));
  } catch (err) {
    await markFailed(userId, sessionId, "coaching", "INTERNAL").catch(() => undefined);
    throw err;
  }

  await setStage(userId, sessionId, "saving");
  try {
    const db = getDb();
    await db.batch(
      completionBatch(db, analysis, {
        sessionId,
        userId,
        modelId: coach.source === "llm" ? coach.model : null,
        attempts: coach.attempts,
        latencyMs: coach.latencyMs,
        asrModel: session.asrModel,
        markComplete: true,
        rewriteTranscript: true,
      }),
    );
  } catch (err) {
    await markFailed(userId, sessionId, "saving", "SERVICE_UNAVAILABLE").catch(() => undefined);
    log.error("analyze.save_failed", { sessionId, detail: err instanceof Error ? err.message.slice(0, 200) : undefined });
    throw new AppError("SERVICE_UNAVAILABLE", { cause: err });
  }
  log.info("analyze.complete", { sessionId, model: coach.source === "llm" ? coach.model : "rules", latencyMs: coach.latencyMs });
  return { status: "complete", feedbackSource: analysis.source };
}
