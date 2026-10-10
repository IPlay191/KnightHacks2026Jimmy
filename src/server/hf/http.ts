import "server-only";

/**
 * Deadline-aware HTTP with retry for Hugging Face (design §4.7, R6.5, NFR-4.1).
 * `fetch`, clock, and sleep are injectable for tests.
 *
 * Endpoint shapes used (verify with `pnpm warmup`):
 *   ASR:  POST https://router.huggingface.co/hf-inference/models/{model}
 *   Chat: POST https://router.huggingface.co/v1/chat/completions
 */
export const HF_ROUTER = "https://router.huggingface.co";

export type FailureKind = "transient" | "config" | "not_found" | "capability" | "bad_input" | "timeout";

export class UpstreamError extends Error {
  readonly kind: FailureKind;
  readonly status?: number;
  readonly retryAfterSec?: number;
  constructor(kind: FailureKind, message: string, opts: { status?: number; retryAfterSec?: number } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.kind = kind;
    this.status = opts.status;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

export interface HttpDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

export const defaultDeps: HttpDeps = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

const MAX_BACKOFF_MS = 8000;

export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(MAX_BACKOFF_MS, secs * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.min(MAX_BACKOFF_MS, Math.max(0, date - nowMs));
  return null;
}

/** Classifies an HTTP failure per the table in design §4.7. */
export function classify(status: number, bodyText: string, kind: "asr" | "llm"): FailureKind {
  const body = bodyText.toLowerCase();
  if (status === 401 || status === 403) return "config";
  if (status === 404 || body.includes("model not supported") || body.includes("not supported by provider")) {
    return "not_found";
  }
  if (status === 429 || status === 502 || status === 503 || status === 504) return "transient";
  if (status >= 500) return "transient";
  if (kind === "llm" && (status === 400 || status === 422) && body.includes("response_format")) return "capability";
  if (status === 400 || status === 415 || status === 422) return "bad_input";
  return "bad_input";
}

export interface RetryOptions {
  url: string;
  init: RequestInit;
  kind: "asr" | "llm";
  /** Absolute epoch ms by which all attempts must finish. */
  deadline: number;
  attemptTimeoutMs: number;
  maxAttempts: number;
  deps?: HttpDeps;
  onAttempt?: (info: { attempt: number; status?: number; failure?: string; latencyMs: number }) => void;
}

/**
 * Runs up to `maxAttempts` attempts. Doesn't start an attempt unless at least
 * half the attempt timeout remains, and trims the timeout to the deadline
 * minus 2 s. Only transient failures are retried.
 */
export async function fetchWithRetry(opts: RetryOptions): Promise<Response> {
  const deps = opts.deps ?? defaultDeps;
  let lastError: UpstreamError | null = null;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const remaining = opts.deadline - deps.now();
    if (remaining < opts.attemptTimeoutMs * 0.5) break;
    const timeout = Math.max(1000, Math.min(opts.attemptTimeoutMs, remaining - 2000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const started = deps.now();
    try {
      const res = await deps.fetch(opts.url, { ...opts.init, signal: controller.signal });
      clearTimeout(timer);
      const latencyMs = deps.now() - started;
      if (res.ok) {
        opts.onAttempt?.({ attempt, status: res.status, latencyMs });
        return res;
      }
      const text = await res.text().catch(() => "");
      const kind = classify(res.status, text, opts.kind);
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"), deps.now());
      opts.onAttempt?.({ attempt, status: res.status, failure: `http_${res.status}`, latencyMs });
      lastError = new UpstreamError(kind, `HTTP ${res.status}`, {
        status: res.status,
        retryAfterSec: retryAfter !== null ? Math.ceil(retryAfter / 1000) : undefined,
      });
      if (kind !== "transient") throw lastError;
      if (attempt < opts.maxAttempts) {
        const backoff = retryAfter ?? Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1)) + Math.floor(deps.random() * 250);
        if (deps.now() + backoff + opts.attemptTimeoutMs * 0.5 > opts.deadline) break;
        await deps.sleep(backoff);
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof UpstreamError) throw err;
      const latencyMs = deps.now() - started;
      const aborted = controller.signal.aborted;
      opts.onAttempt?.({ attempt, failure: aborted ? "timeout" : "network", latencyMs });
      lastError = new UpstreamError(aborted ? "timeout" : "transient", aborted ? "attempt timed out" : "network error");
      if (attempt < opts.maxAttempts) {
        const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1)) + Math.floor(deps.random() * 250);
        if (deps.now() + backoff + opts.attemptTimeoutMs * 0.5 > opts.deadline) break;
        await deps.sleep(backoff);
      }
    }
  }
  throw lastError ?? new UpstreamError("timeout", "deadline exhausted before an attempt could start");
}
