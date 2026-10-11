"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PreparedChunk } from "@/lib/audio/prepare";
import type { PipelineStage, SessionStatus } from "@/lib/types";
import { analyze, ApiError, getStatus, uploadChunk, type StatusResponse } from "./api-client";

/**
 * Client-driven pipeline (design §10.6, R5.4, R5.6, R9): upload chunks
 * (3 in flight, 2 retries each), request analysis, and poll status every
 * 1.5 s. Resumes from server state after a reload (R9.8).
 */
export const STAGE_KEYS = ["prepare", "transcribe", "metrics", "coaching", "saving"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];
export type StageStatus = "pending" | "active" | "done" | "failed";

export interface PipelineError {
  stage: StageKey;
  code: string;
  message: string;
  action: "retry" | "record";
}

export interface PipelineView {
  phase: "starting" | "running" | "complete" | "failed" | "interrupted";
  stages: Record<StageKey, StageStatus>;
  activeStage: StageKey | null;
  chunksDone: number;
  chunksExpected: number;
  error: PipelineError | null;
  connectionLost: boolean;
  /** Epoch ms when the current active stage began (for the 20 s reassurance, R9.5). */
  stageSince: number;
}

const POLL_MS = 1500;
const MAX_POLL_BACKOFF_MS = 5000;
const UPLOAD_CONCURRENCY = 3;
const UPLOAD_RETRIES = 2;
const STALE_ANALYSIS_MS = 150_000;

const SERVER_STAGE: Record<PipelineStage, StageKey> = {
  transcribing: "transcribe",
  metrics: "metrics",
  coaching: "coaching",
  saving: "saving",
};

export function stagesFor(active: StageKey | null, failed: StageKey | null, complete: boolean): Record<StageKey, StageStatus> {
  const out = {} as Record<StageKey, StageStatus>;
  const pivot = failed ?? active;
  const pivotIdx = pivot ? STAGE_KEYS.indexOf(pivot) : complete ? STAGE_KEYS.length : -1;
  STAGE_KEYS.forEach((k, i) => {
    if (complete) out[k] = "done";
    else if (i < pivotIdx) out[k] = "done";
    else if (i === pivotIdx) out[k] = failed ? "failed" : "active";
    else out[k] = "pending";
  });
  return out;
}

export function activeStageFromStatus(s: Pick<StatusResponse, "status" | "stage">): StageKey | null {
  const status: SessionStatus = s.status;
  if (status === "created" || status === "uploading") return "transcribe";
  if (status === "transcribed") return "metrics";
  if (status === "analyzing") return s.stage ? SERVER_STAGE[s.stage] : "metrics";
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function usePipeline(sessionId: string, chunks: PreparedChunk[] | null, onAudioReleased?: () => void) {
  const [view, setView] = useState<PipelineView>({
    phase: "starting",
    stages: stagesFor("transcribe", null, false),
    activeStage: "transcribe",
    chunksDone: 0,
    chunksExpected: chunks?.length ?? 0,
    error: null,
    connectionLost: false,
    stageSince: 0,
  });
  const alive = useRef(true);
  const running = useRef(false);
  const chunksRef = useRef(chunks);
  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  const setActive = useCallback((active: StageKey | null, patch: Partial<PipelineView> = {}) => {
    if (!alive.current) return;
    setView((v) => ({
      ...v,
      ...patch,
      activeStage: active,
      stages: stagesFor(active, null, false),
      stageSince: v.activeStage === active && v.stageSince > 0 ? v.stageSince : Date.now(),
    }));
  }, []);

  const fail = useCallback((error: PipelineError) => {
    if (!alive.current) return;
    setView((v) => ({ ...v, phase: "failed", error, stages: stagesFor(null, error.stage, false), activeStage: null }));
  }, []);

  const complete = useCallback(() => {
    if (!alive.current) return;
    setView((v) => ({ ...v, phase: "complete", stages: stagesFor(null, null, true), activeStage: null, error: null }));
  }, []);

  /** Polls status until complete/failed or until `stop()` returns true. */
  const pollUntilDone = useCallback(
    async (stop: () => boolean): Promise<StatusResponse | null> => {
      let failures = 0;
      while (alive.current && !stop()) {
        try {
          const s = await getStatus(sessionId);
          failures = 0;
          if (alive.current) setView((v) => (v.connectionLost ? { ...v, connectionLost: false } : v));
          if (s.status === "complete" || s.status === "failed") return s;
          setActive(activeStageFromStatus(s), { chunksDone: s.chunksDone, chunksExpected: s.chunksExpected });
          await sleep(POLL_MS);
        } catch {
          failures++;
          if (failures >= 5 && alive.current) setView((v) => ({ ...v, connectionLost: true }));
          await sleep(Math.min(MAX_POLL_BACKOFF_MS, POLL_MS * 2 ** Math.min(failures, 3)));
        }
      }
      return null;
    },
    [sessionId, setActive],
  );

  const failedFromStatus = useCallback(
    (s: StatusResponse) => {
      const stage: StageKey = s.failedStage ? SERVER_STAGE[s.failedStage] : "metrics";
      const err = s.error ?? { code: "INTERNAL", message: "Something went wrong on our side.", retryable: true };
      fail({
        stage,
        code: err.code,
        message: err.message,
        action: err.retryable && err.code !== "NO_SPEECH_DETECTED" ? "retry" : "record",
      });
    },
    [fail],
  );

  const uploadAll = useCallback(
    async (indexes: number[], expected: number): Promise<boolean> => {
      const all = chunksRef.current ?? [];
      const queue = all.filter((c) => indexes.includes(c.index));
      if (queue.length !== indexes.length) return false;
      let done = expected - indexes.length;
      let failed: ApiError | null = null;
      setActive("transcribe", { chunksDone: done, chunksExpected: expected, phase: "running" });
      const worker = async () => {
        while (queue.length && !failed && alive.current) {
          const chunk = queue.shift();
          if (!chunk) break;
          for (let attempt = 0; ; attempt++) {
            try {
              await uploadChunk(sessionId, chunk);
              done++;
              setActive("transcribe", { chunksDone: done, chunksExpected: expected });
              break;
            } catch (err) {
              const apiErr = err instanceof ApiError ? err : new ApiError("INTERNAL", "Upload failed.", 0, true);
              if (apiErr.code === "CONFLICT_STATE") break; // already analyzing or done
              if (!apiErr.retryable || attempt >= UPLOAD_RETRIES) {
                failed = apiErr;
                return;
              }
              await sleep(apiErr.extra.retryAfterSec ? apiErr.extra.retryAfterSec * 1000 : attempt === 0 ? 1000 : 3000);
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length || 1) }, worker));
      if (failed) {
        const e = failed as ApiError;
        fail({
          stage: "transcribe",
          code: e.code,
          message: e.message,
          // Config and credit problems are fixable without re-recording, so offer Retry.
          action: e.retryable || e.code === "UPSTREAM_CONFIG" || e.code === "UPSTREAM_QUOTA" ? "retry" : "record",
        });
        return false;
      }
      return true;
    },
    [sessionId, setActive, fail],
  );

  const runAnalysis = useCallback(async (): Promise<void> => {
    // At most one re-upload round for chunks the server reports missing.
    for (let round = 0; round < 2; round++) {
      setActive("metrics", { phase: "running" });
      let finished = false;
      const analysis = analyze(sessionId)
        .then(() => ({ ok: true as const }))
        .catch((err: unknown) => ({ ok: false as const, err }))
        .finally(() => {
          finished = true;
        });
      const polled = pollUntilDone(() => finished);
      const result = await analysis;
      await polled;
      if (!alive.current) return;
      if (result.ok) {
        complete();
        return;
      }
      const err = result.err instanceof ApiError ? result.err : new ApiError("INTERNAL", "Analysis failed.", 0, true);
      if (err.code === "ANALYSIS_IN_PROGRESS" || err.status === 0 || err.status >= 500) {
        // The analysis may still be running server-side (or the connection dropped): follow the status.
        const s = await pollUntilDone(() => false);
        if (!s) return;
        if (s.status === "complete") complete();
        else failedFromStatus(s);
        return;
      }
      if (err.code === "CHUNKS_INCOMPLETE" && round === 0) {
        const missing = err.extra.missingChunks ?? [];
        const expected = chunksRef.current?.length ?? 0;
        if (!chunksRef.current?.length) {
          setView((v) => ({ ...v, phase: "interrupted" }));
          return;
        }
        if (missing.length && (await uploadAll(missing, expected))) continue;
        return;
      }
      fail({
        stage: err.code === "NO_SPEECH_DETECTED" ? "metrics" : "coaching",
        code: err.code,
        message: err.message,
        action: err.retryable ? "retry" : "record",
      });
      return;
    }
  }, [sessionId, setActive, pollUntilDone, complete, failedFromStatus, uploadAll, fail]);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      setView((v) => ({ ...v, error: null, phase: "running" }));
      let s: StatusResponse;
      try {
        s = await getStatus(sessionId);
      } catch (err) {
        const e = err instanceof ApiError ? err : null;
        if (e?.code === "NOT_FOUND") {
          setView((v) => ({ ...v, phase: "interrupted" }));
          return;
        }
        fail({ stage: "transcribe", code: e?.code ?? "SERVICE_UNAVAILABLE", message: e?.message ?? "We couldn't reach the server.", action: "retry" });
        return;
      }
      setView((v) => ({ ...v, chunksDone: s.chunksDone, chunksExpected: s.chunksExpected }));
      if (s.status === "complete") return complete();
      if (s.status === "failed") {
        if (s.error?.retryable && s.error.code !== "NO_SPEECH_DETECTED") return await runAnalysis();
        return failedFromStatus(s);
      }
      if (s.status === "analyzing") {
        const stale = Date.now() - Date.parse(s.updatedAt) > STALE_ANALYSIS_MS;
        if (stale) return await runAnalysis();
        const final = await pollUntilDone(() => false);
        if (!final) return;
        return final.status === "complete" ? complete() : failedFromStatus(final);
      }
      if (s.status === "transcribed" || s.missingChunks.length === 0) return await runAnalysis();
      // created / uploading with missing chunks
      if (!chunksRef.current?.length) {
        setView((v) => ({ ...v, phase: "interrupted" }));
        return;
      }
      if (await uploadAll(s.missingChunks, s.chunksExpected)) {
        onAudioReleased?.();
        await runAnalysis();
      }
    } finally {
      running.current = false;
    }
  }, [sessionId, complete, failedFromStatus, runAnalysis, pollUntilDone, uploadAll, fail, onAudioReleased]);

  useEffect(() => {
    alive.current = true;
    // Deferred so React Strict Mode's mount/unmount/mount in development
    // doesn't start two pipelines.
    const timer = setTimeout(() => void run(), 0);
    return () => {
      clearTimeout(timer);
      alive.current = false;
    };
    // Run once per session; `retry` re-invokes run explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return { view, retry: run };
}
