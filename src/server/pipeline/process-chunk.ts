import "server-only";
import { MAX_CHUNK_SPAN_MS } from "@/lib/validation";
import { AppError } from "@/server/errors";
import { log } from "@/server/log";
import { parseWav, WavError } from "@/server/audio/wav-parse";
import { detectSilences } from "@/server/analysis/silence";
import { completeChunk, getChunk, markChunkFailed, markChunkTranscribing } from "@/server/db/queries/chunks";
import { getOwnedSession } from "@/server/db/queries/sessions";
import { transcribeChunk } from "@/server/hf/asr";
import { UpstreamError } from "@/server/hf/http";

export const MAX_CHUNK_BYTES = 1_000_000;
const DURATION_TOLERANCE_MS = 250;
const OFFSET_TOLERANCE_MS = 5;

export interface ChunkRequest {
  userId: string;
  sessionId: string;
  index: number;
  startMs: number;
  endMs: number;
  contentType: string | null;
  body: Uint8Array;
  deadline: number;
}

export interface ChunkResponse {
  index: number;
  status: "done";
  chunksDone: number;
  chunksExpected: number;
  sessionStatus: string;
}

function upstreamToAppError(err: UpstreamError): AppError {
  switch (err.kind) {
    case "config":
      return new AppError("UPSTREAM_CONFIG");
    case "bad_input":
      return new AppError("UNSUPPORTED_AUDIO");
    case "timeout":
      return new AppError("UPSTREAM_TIMEOUT", { retryAfterSec: 5 });
    case "not_found":
      return new AppError("UPSTREAM_CONFIG");
    default:
      return err.status && err.status >= 500 && err.status !== 503
        ? new AppError("UPSTREAM_FAILED", { retryAfterSec: err.retryAfterSec ?? 5 })
        : new AppError("UPSTREAM_BUSY", { retryAfterSec: err.retryAfterSec ?? 5 });
  }
}

/**
 * Validates, transcribes, and stores one chunk (design §9.2). Idempotent:
 * re-uploading a finished chunk returns its stored result.
 */
export async function processChunk(req: ChunkRequest): Promise<ChunkResponse> {
  const session = await getOwnedSession(req.userId, req.sessionId);
  if (!session) throw new AppError("NOT_FOUND");
  if (session.status === "analyzing" || session.status === "complete" || session.status === "failed") {
    const existing = await getChunk(req.sessionId, req.index);
    if (existing?.status === "done") {
      return {
        index: req.index,
        status: "done",
        chunksDone: session.expectedChunks,
        chunksExpected: session.expectedChunks,
        sessionStatus: session.status,
      };
    }
    throw new AppError("CONFLICT_STATE");
  }

  // Index and offset validation (design §9.8).
  if (!Number.isInteger(req.index) || req.index < 0 || req.index >= session.expectedChunks) {
    throw new AppError("VALIDATION_FAILED", { message: "Chunk index is out of range." });
  }
  const { startMs, endMs } = req;
  if (
    !Number.isInteger(startMs) ||
    !Number.isInteger(endMs) ||
    startMs < 0 ||
    endMs <= startMs ||
    endMs > session.durationMs + 500 ||
    endMs - startMs > MAX_CHUNK_SPAN_MS
  ) {
    throw new AppError("VALIDATION_FAILED", { message: "Chunk offsets are invalid." });
  }
  if (req.index === 0 && startMs > OFFSET_TOLERANCE_MS) {
    throw new AppError("VALIDATION_FAILED", { message: "The first chunk must start at 0." });
  }
  if (req.index > 0) {
    const prev = await getChunk(req.sessionId, req.index - 1);
    if (prev && Math.abs(prev.endMs - startMs) > OFFSET_TOLERANCE_MS) {
      throw new AppError("VALIDATION_FAILED", { message: "Chunk offsets don't line up with the previous chunk." });
    }
  }
  if (req.contentType?.split(";")[0]?.trim().toLowerCase() !== "audio/wav") {
    throw new AppError("UNSUPPORTED_AUDIO");
  }
  if (req.body.length > MAX_CHUNK_BYTES) throw new AppError("PAYLOAD_TOO_LARGE");

  const existing = await getChunk(req.sessionId, req.index);
  if (existing?.status === "done" && existing.startMs === startMs && existing.endMs === endMs) {
    return {
      index: req.index,
      status: "done",
      chunksDone: 0,
      chunksExpected: session.expectedChunks,
      sessionStatus: session.status,
    };
  }

  let wav;
  try {
    wav = parseWav(req.body);
  } catch (err) {
    if (err instanceof WavError) {
      log.warn("chunk.bad_wav", { sessionId: req.sessionId, chunkIndex: req.index, detail: err.message });
      throw new AppError("UNSUPPORTED_AUDIO");
    }
    throw err;
  }
  if (Math.abs(wav.durationMs - (endMs - startMs)) > DURATION_TOLERANCE_MS) {
    throw new AppError("UNSUPPORTED_AUDIO", { message: "The audio length doesn't match its offsets." });
  }

  await markChunkTranscribing(req.sessionId, req.index, startMs, endMs);
  const { silences, voicedRatio } = detectSilences(wav.samples, wav.sampleRate, startMs);

  let asr;
  try {
    asr = await transcribeChunk({ wav: req.body, startMs, endMs, voicedRatio }, { deadline: req.deadline });
  } catch (err) {
    const appErr = err instanceof UpstreamError ? upstreamToAppError(err) : new AppError("UPSTREAM_FAILED");
    await markChunkFailed(req.sessionId, req.index, appErr.code).catch(() => undefined);
    log[appErr.code === "UPSTREAM_CONFIG" ? "error" : "warn"]("chunk.asr_failed", {
      sessionId: req.sessionId,
      chunkIndex: req.index,
      code: appErr.code,
      status: err instanceof UpstreamError ? err.status : undefined,
      failure: err instanceof UpstreamError ? err.kind : "error",
    });
    throw appErr;
  }

  const result = await completeChunk({
    sessionId: req.sessionId,
    index: req.index,
    startMs,
    endMs,
    voicedRatio: Math.max(0, Math.min(1, voicedRatio)),
    silences,
    asrText: asr.text,
    asrSegments: asr.segments,
    asrWordLevel: asr.wordLevel,
    asrModel: asr.model,
    asrLatencyMs: asr.latencyMs,
  });
  log.info("chunk.done", {
    sessionId: req.sessionId,
    chunkIndex: req.index,
    model: asr.model,
    latencyMs: asr.latencyMs,
  });
  return {
    index: req.index,
    status: "done",
    chunksDone: result.chunksDone,
    chunksExpected: session.expectedChunks,
    sessionStatus: result.status,
  };
}
