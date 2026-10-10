import "server-only";
import { z } from "zod";
import { normalizeForMatch } from "@/lib/text";
import type { TimedText } from "@/lib/types";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";
import { defaultDeps, fetchWithRetry, HF_ROUTER, UpstreamError, type HttpDeps } from "./http";
import { mockTranscribe } from "./mock";

/** Whisper speech-to-text via Hugging Face Inference Providers (design §4.2, R6). */
const RawChunk = z.object({
  text: z.string().catch(""),
  // Providers differ: [start, end], [start, null], or missing.
  timestamp: z.array(z.number().nullable()).optional().nullable(),
});
const RawAsr = z.object({
  text: z.string(),
  chunks: z.array(RawChunk).optional().nullable().catch(null),
});

/** Normalized ASR response: `{ text, chunks: [{ text, timestamp: [start, end] }] }`. */
export interface AsrResponse {
  text: string;
  chunks?: { text: string; timestamp: [number | null, number | null] }[] | null;
}

/**
 * Lenient parsing of the ASR reply. Accepts a bare object or a one-element
 * array, and tolerates missing or partial timestamps.
 */
export function parseAsrResponse(json: unknown): AsrResponse | null {
  const candidate = Array.isArray(json) ? json[0] : json;
  const parsed = RawAsr.safeParse(candidate);
  if (!parsed.success) return null;
  const chunks = parsed.data.chunks
    ?.filter((c) => Array.isArray(c.timestamp) && c.timestamp.length > 0)
    .map((c) => ({
      text: c.text,
      timestamp: [c.timestamp?.[0] ?? null, c.timestamp?.[1] ?? null] as [number | null, number | null],
    }));
  return { text: parsed.data.text, chunks: chunks && chunks.length ? chunks : null };
}

export interface AsrChunkInput {
  wav: Uint8Array;
  startMs: number;
  endMs: number;
  voicedRatio: number;
}

export interface AsrResult {
  text: string;
  /** Session-relative segments, or null when ASR gave no timestamps (R6.3). */
  segments: TimedText[] | null;
  wordLevel: boolean;
  model: string;
  latencyMs: number;
  skipped: boolean;
}

const ASR_ATTEMPT_TIMEOUT_MS = 45_000;
const SKIP_VOICED_RATIO = 0.05;
const HALLUCINATION_VOICED_RATIO = 0.15;
const HALLUCINATIONS = new Set(["thank you", "thanks for watching", "you", "bye", "subtitles by", "thank you for watching"]);

/**
 * Converts chunk-relative seconds to monotonic session milliseconds clamped
 * to the chunk span. A null end becomes the chunk end (P4).
 */
export function mapTimestamps(chunks: NonNullable<AsrResponse["chunks"]>, startMs: number, endMs: number): TimedText[] {
  const out: TimedText[] = [];
  let cursor = startMs;
  for (const c of chunks) {
    const text = c.text.trim();
    if (!text) continue;
    const [rawStart, rawEnd] = c.timestamp;
    const toMs = (t: number | null, fallback: number) =>
      t === null || !Number.isFinite(t) ? fallback : startMs + Math.round(t * 1000);
    let s = toMs(rawStart, cursor);
    let e = toMs(rawEnd, endMs);
    s = Math.min(endMs, Math.max(startMs, s, cursor));
    e = Math.min(endMs, Math.max(s, e));
    out.push({ text, startMs: s, endMs: e });
    cursor = s;
  }
  return out;
}

export function isWordLevel(segments: TimedText[]): boolean {
  return segments.length > 0 && segments.every((s) => s.text.trim().split(/\s+/).length === 1);
}

export function isSilenceHallucination(text: string, voicedRatio: number): boolean {
  if (voicedRatio >= HALLUCINATION_VOICED_RATIO) return false;
  return HALLUCINATIONS.has(normalizeForMatch(text));
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/**
 * Request formats:
 * - "json": `{ inputs: base64, parameters: { return_timestamps: true } }` (segment timing)
 * - "raw":  the WAV bytes with `Content-Type: audio/wav` (no timestamps; timing is
 *   then interpolated across voiced regions, R6.3). Used when "json" is rejected.
 */
type AsrMode = "json" | "raw";

async function callModel(
  model: string,
  input: AsrChunkInput,
  deadline: number,
  deps: HttpDeps,
  token: string,
  maxAttempts: number,
  mode: AsrMode,
): Promise<{ body: AsrResponse; latencyMs: number }> {
  const started = deps.now();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    // Ask hf-inference to wait for a cold model instead of returning 503 immediately.
    "x-wait-for-model": "true",
  };
  let body: BodyInit;
  if (mode === "json") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ inputs: toBase64(input.wav), parameters: { return_timestamps: true } });
  } else {
    headers["Content-Type"] = "audio/wav";
    body = new Blob([input.wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" });
  }
  const res = await fetchWithRetry({
    url: `${HF_ROUTER}/hf-inference/models/${model}`,
    kind: "asr",
    deadline,
    attemptTimeoutMs: ASR_ATTEMPT_TIMEOUT_MS,
    maxAttempts,
    deps,
    init: { method: "POST", headers, body },
    onAttempt: (a) =>
      a.failure &&
      log.warn("hf.asr.attempt", {
        model,
        attempt: a.attempt,
        status: a.status,
        failure: `${mode}:${a.failure}`,
        latencyMs: a.latencyMs,
        detail: a.detail,
      }),
  });
  const json: unknown = await res.json().catch(() => null);
  const parsed = parseAsrResponse(json);
  if (!parsed) {
    log.warn("hf.asr.bad_shape", {
      model,
      failure: mode,
      detail: JSON.stringify(json ?? null).slice(0, 200).replace(/"text":"[^"]*"/g, '"text":"…"'),
    });
    throw new UpstreamError("bad_input", "unexpected ASR response shape");
  }
  return { body: parsed, latencyMs: deps.now() - started };
}

/** One model: JSON with timestamps first, then raw audio if the JSON form is rejected. */
async function transcribeWith(
  model: string,
  input: AsrChunkInput,
  deadline: number,
  deps: HttpDeps,
  token: string,
  maxAttempts: number,
): Promise<{ body: AsrResponse; latencyMs: number }> {
  try {
    return await callModel(model, input, deadline, deps, token, maxAttempts, "json");
  } catch (err) {
    if (err instanceof UpstreamError && err.kind === "bad_input") {
      log.warn("hf.asr.retry_raw", { model, status: err.status });
      return callModel(model, input, deadline, deps, token, 1, "raw");
    }
    throw err;
  }
}

export function toAsrResult(body: AsrResponse, input: AsrChunkInput, model: string, latencyMs: number): AsrResult {
  const text = body.text.trim();
  if (isSilenceHallucination(text, input.voicedRatio)) {
    return { text: "", segments: [], wordLevel: false, model, latencyMs, skipped: false };
  }
  const segments = body.chunks && body.chunks.length > 0 ? mapTimestamps(body.chunks, input.startMs, input.endMs) : null;
  return { text, segments, wordLevel: segments ? isWordLevel(segments) : false, model, latencyMs, skipped: false };
}

/**
 * Transcribes one chunk: primary model with retries, then the fallback model
 * once (R6.5). Silent chunks skip the call entirely (R6.4).
 */
export async function transcribeChunk(
  input: AsrChunkInput,
  opts: { deadline: number; deps?: HttpDeps },
): Promise<AsrResult> {
  const env = getEnv();
  if (input.voicedRatio < SKIP_VOICED_RATIO) {
    return { text: "", segments: [], wordLevel: false, model: "skipped-silent", latencyMs: 0, skipped: true };
  }
  if (env.HF_MOCK) return mockTranscribe(input);
  const deps = opts.deps ?? defaultDeps;
  const token = env.HF_TOKEN ?? "";
  try {
    const { body, latencyMs } = await transcribeWith(env.HF_ASR_MODEL, input, opts.deadline, deps, token, 3);
    return toAsrResult(body, input, env.HF_ASR_MODEL, latencyMs);
  } catch (err) {
    // Auth problems won't be fixed by another model; everything else gets one fallback try.
    if (!(err instanceof UpstreamError) || err.kind === "config") throw err;
    log.warn("hf.asr.fallback", { model: env.HF_ASR_FALLBACK_MODEL, failure: err.kind, status: err.status });
    const { body, latencyMs } = await transcribeWith(env.HF_ASR_FALLBACK_MODEL, input, opts.deadline, deps, token, 1);
    return toAsrResult(body, input, env.HF_ASR_FALLBACK_MODEL, latencyMs);
  }
}
