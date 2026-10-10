import { ERROR_CATALOG, isErrorCode, type ErrorCode } from "@/lib/errors";
import type { Audience, PipelineStage, SessionStatus } from "@/lib/types";

/** Typed fetch wrapper that turns the error envelope into ApiError (R17.1). */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly extra: { retryAfterSec?: number; missingChunks?: number[]; fieldErrors?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError("SERVICE_UNAVAILABLE", "You appear to be offline. Check your connection and retry.", 0, true);
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.ok) return body as T;
  const env = (body as { error?: Record<string, unknown> } | null)?.error;
  const code = isErrorCode(env?.code) ? env.code : res.status >= 500 ? "INTERNAL" : "VALIDATION_FAILED";
  const message = typeof env?.message === "string" ? env.message : ERROR_CATALOG[code].message;
  const retryable = typeof env?.retryable === "boolean" ? env.retryable : ERROR_CATALOG[code].retryable;
  throw new ApiError(code, message, res.status, retryable, {
    retryAfterSec: typeof env?.retryAfterSec === "number" ? env.retryAfterSec : undefined,
    missingChunks: Array.isArray(env?.missingChunks) ? (env.missingChunks as number[]) : undefined,
    fieldErrors: (env?.fieldErrors as Record<string, string> | undefined) ?? undefined,
  });
}

export interface CreateSessionInput {
  title: string | null;
  goal: string | null;
  durationMs: number;
  expectedChunks: number;
  videoCaptured: boolean;
  timeZone: string;
  audience: Audience;
}

export function createSession(input: CreateSessionInput) {
  return request<{ sessionId: string; chunkUploadConcurrency: number }>("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function uploadChunk(sessionId: string, chunk: { index: number; startMs: number; endMs: number; wav: Blob }) {
  const qs = new URLSearchParams({ startMs: String(chunk.startMs), endMs: String(chunk.endMs) });
  return request<{ index: number; status: "done"; chunksDone: number; chunksExpected: number; sessionStatus: SessionStatus }>(
    `/api/sessions/${sessionId}/chunks/${chunk.index}?${qs.toString()}`,
    { method: "PUT", headers: { "Content-Type": "audio/wav" }, body: chunk.wav },
  );
}

export function analyze(sessionId: string) {
  return request<{ status: "complete"; feedbackSource: "llm" | "rules" }>(`/api/sessions/${sessionId}/analyze`, {
    method: "POST",
  });
}

export function retryCoaching(sessionId: string) {
  return request<{ feedbackSource: "llm" | "rules" }>(`/api/sessions/${sessionId}/coaching`, { method: "POST" });
}

export interface StatusResponse {
  status: SessionStatus;
  stage: PipelineStage | null;
  chunksDone: number;
  chunksExpected: number;
  missingChunks: number[];
  failedStage: PipelineStage | null;
  error: { code: string; message: string; retryable: boolean } | null;
  updatedAt: string;
}

export function getStatus(sessionId: string) {
  return request<StatusResponse>(`/api/sessions/${sessionId}/status`, { method: "GET" });
}

export function deleteSession(sessionId: string) {
  return request<void>(`/api/sessions/${sessionId}`, { method: "DELETE" });
}
