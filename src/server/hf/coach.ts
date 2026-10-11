import "server-only";
import { z } from "zod";
import { CoachingFeedback } from "@/lib/coaching";
import type { ResolvedProfile } from "@/lib/audience";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";
import type { FillerCandidate } from "@/server/analysis/fillers";
import { defaultDeps, fetchWithRetry, HF_ROUTER, UpstreamError, type HttpDeps } from "./http";
import { MOCK_LLM_MODEL, mockCoachingJson } from "./mock";
import { normalizeCoaching, parseCoaching } from "./parse";
import { buildRepairPrompt, buildUserPrompt, SYSTEM_PROMPT, type PromptInput } from "./prompts";

/**
 * Coaching generation (design §4.6, R8.1–8.6, R8.9). Tries each model in the
 * chain (primary, fallback, then an ungated safety net), each with one repair
 * round, before degrading to rule-based tips. Only a missing-credits error
 * stops the chain early, since every model bills the same account.
 */
const LLM_ATTEMPT_TIMEOUT_MS = 75_000;
/** Ungated open model used as a last resort when gated models are refused. */
export const SAFETY_NET_MODEL = "Qwen/Qwen2.5-72B-Instruct";
let cachedSchema: Record<string, unknown> | null = null;

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "pattern",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "format",
]);

/** Strips keywords some providers reject in strict mode. Zod still validates fully. */
function simplifySchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplifySchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(k)) continue;
    out[k] = simplifySchema(v);
  }
  return out;
}

export function coachingJsonSchema(): Record<string, unknown> {
  cachedSchema ??= simplifySchema(z.toJSONSchema(CoachingFeedback, { target: "draft-7" })) as Record<string, unknown>;
  return cachedSchema;
}

export interface CoachInput extends PromptInput {
  candidates: FillerCandidate[];
  transcriptText: string;
  profile: ResolvedProfile;
  /** Test hook used only with HF_MOCK: force every LLM attempt to fail. */
  mockFail?: boolean;
}

export type CoachResult =
  | { source: "llm"; feedback: CoachingFeedback; model: string; attempts: number; latencyMs: number }
  | { source: "rules"; attempts: number; latencyMs: number; reason: string };

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const ChatResponse = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional() }) }))
    .min(1),
});

async function chat(
  model: string,
  messages: ChatMessage[],
  useSchema: boolean,
  deadline: number,
  deps: HttpDeps,
  maxAttempts: number,
): Promise<string> {
  const env = getEnv();
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 1500,
    seed: 7,
  };
  if (useSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "coaching_feedback", schema: coachingJsonSchema(), strict: true },
    };
  }
  const res = await fetchWithRetry({
    url: `${HF_ROUTER}/v1/chat/completions`,
    kind: "llm",
    deadline,
    attemptTimeoutMs: LLM_ATTEMPT_TIMEOUT_MS,
    maxAttempts,
    deps,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${env.HF_TOKEN ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    onAttempt: (a) =>
      a.failure &&
      log.warn("hf.llm.attempt", {
        model,
        attempt: a.attempt,
        status: a.status,
        failure: `${useSchema ? "schema" : "plain"}:${a.failure}`,
        latencyMs: a.latencyMs,
        detail: a.detail,
      }),
  });
  const parsed = ChatResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new UpstreamError("transient", "unexpected chat response shape");
  return parsed.data.choices[0]?.message.content ?? "";
}

/** Unique, non-empty model chain: primary, fallback, then the ungated safety net. */
export function modelChain(primary: string, fallback: string): string[] {
  return [...new Set([primary, fallback, SAFETY_NET_MODEL].map((m) => m.trim()).filter(Boolean))];
}

export async function generateCoaching(
  input: CoachInput,
  opts: { deadline: number; deps?: HttpDeps },
): Promise<CoachResult> {
  const env = getEnv();
  const deps = opts.deps ?? defaultDeps;
  const started = deps.now();
  const candidateIds = new Set(input.candidates.slice(0, 150).map((c) => c.id));
  const finish = (fb: CoachingFeedback, model: string, attempts: number): CoachResult => {
    log.info("hf.llm.ok", { model, attempt: attempts, latencyMs: deps.now() - started });
    return {
      source: "llm",
      feedback: normalizeCoaching(fb, { candidateIds, transcript: input.transcriptText }),
      model,
      attempts,
      latencyMs: deps.now() - started,
    };
  };
  const rules = (attempts: number, reason: string): CoachResult => {
    log.error("hf.llm.degraded_to_rules", { attempt: attempts, failure: reason });
    return { source: "rules", attempts, latencyMs: deps.now() - started, reason };
  };

  if (env.HF_MOCK) {
    if (input.mockFail) return rules(1, "mock_fail");
    const raw = mockCoachingJson({
      candidates: input.candidates,
      transcript: input.transcriptText,
      audienceLabel: input.profile.profile.label,
    });
    const out = parseCoaching(raw);
    return out.ok ? finish(out.value, MOCK_LLM_MODEL, 1) : rules(1, "mock_invalid");
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(input) },
  ];
  let attempts = 0;
  let lastReason = "unavailable";

  /**
   * One request with structured output; if the provider rejects the schema
   * (any 400/422), retry the same model once as plain text. The prompt
   * already describes the shape and the parser is lenient.
   */
  const ask = async (model: string, msgs: ChatMessage[], maxAttempts: number): Promise<string> => {
    attempts++;
    try {
      return await chat(model, msgs, true, opts.deadline, deps, maxAttempts);
    } catch (err) {
      if (err instanceof UpstreamError && (err.kind === "capability" || err.kind === "bad_input")) {
        attempts++;
        return chat(model, msgs, false, opts.deadline, deps, maxAttempts);
      }
      throw err;
    }
  };

  for (const [i, model] of modelChain(env.HF_LLM_MODEL, env.HF_LLM_FALLBACK_MODEL).entries()) {
    if (opts.deadline - deps.now() < 20_000) {
      lastReason = "deadline";
      break;
    }
    try {
      const first = await ask(model, messages, i === 0 ? 2 : 1);
      const parsed = parseCoaching(first);
      if (parsed.ok) return finish(parsed.value, model, attempts);
      log.warn("hf.llm.invalid", { model, attempt: attempts, failure: parsed.failure, detail: parsed.issues.slice(0, 3).join("; ") });
      lastReason = parsed.failure;
      if (opts.deadline - deps.now() < 25_000) continue;
      const repaired = await ask(
        model,
        [
          ...messages,
          { role: "assistant", content: parsed.raw.slice(0, 8000) },
          { role: "user", content: buildRepairPrompt(parsed.issues) },
        ],
        1,
      );
      const reparsed = parseCoaching(repaired);
      if (reparsed.ok) return finish(reparsed.value, model, attempts);
      log.warn("hf.llm.invalid", { model, attempt: attempts, failure: reparsed.failure, detail: reparsed.issues.slice(0, 3).join("; ") });
      lastReason = reparsed.failure;
    } catch (err) {
      const kind = err instanceof UpstreamError ? err.kind : "error";
      const status = err instanceof UpstreamError ? err.status : undefined;
      lastReason = `${kind}${status ? `_${status}` : ""}`;
      log.warn("hf.llm.model_failed", { model, attempt: attempts, failure: kind, status });
      // No credits: every model bills the same account. A bad token (401) fails everywhere too.
      if (kind === "quota" || status === 401) return rules(attempts, lastReason);
      // 403 is usually a gated model whose license wasn't accepted; the next model may work.
    }
  }
  return rules(attempts, lastReason);
}
