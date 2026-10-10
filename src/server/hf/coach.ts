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
 * Coaching generation with parse → repair → fallback model → rules
 * (design §4.6, R8.1–8.6, R8.9).
 */
const LLM_ATTEMPT_TIMEOUT_MS = 40_000;
let cachedSchema: Record<string, unknown> | null = null;

export function coachingJsonSchema(): Record<string, unknown> {
  cachedSchema ??= z.toJSONSchema(CoachingFeedback, { target: "draft-7" }) as Record<string, unknown>;
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
    temperature: 0.3,
    max_tokens: 1800,
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
      a.failure && log.warn("hf.llm.attempt", { model, attempt: a.attempt, status: a.status, failure: a.failure, latencyMs: a.latencyMs }),
  });
  const parsed = ChatResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new UpstreamError("transient", "unexpected chat response shape");
  return parsed.data.choices[0]?.message.content ?? "";
}

export async function generateCoaching(
  input: CoachInput,
  opts: { deadline: number; deps?: HttpDeps },
): Promise<CoachResult> {
  const env = getEnv();
  const deps = opts.deps ?? defaultDeps;
  const started = deps.now();
  const candidateIds = new Set(input.candidates.slice(0, 150).map((c) => c.id));
  const finish = (fb: CoachingFeedback, model: string, attempts: number): CoachResult => ({
    source: "llm",
    feedback: normalizeCoaching(fb, { candidateIds, transcript: input.transcriptText }),
    model,
    attempts,
    latencyMs: deps.now() - started,
  });
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

  /** One logical attempt against a model, with the response_format capability fallback. */
  const attemptModel = async (model: string, msgs: ChatMessage[], maxAttempts: number) => {
    attempts++;
    try {
      return { content: await chat(model, msgs, true, opts.deadline, deps, maxAttempts) };
    } catch (err) {
      if (err instanceof UpstreamError && err.kind === "capability") {
        attempts++;
        return { content: await chat(model, msgs, false, opts.deadline, deps, maxAttempts) };
      }
      throw err;
    }
  };

  // Attempt 1 (+ repair) on the primary model.
  const primary = env.HF_LLM_MODEL;
  try {
    const first = await attemptModel(primary, messages, 2);
    const parsed = parseCoaching(first.content);
    if (parsed.ok) return finish(parsed.value, primary, attempts);
    log.warn("hf.llm.invalid", { model: primary, attempt: attempts, failure: parsed.failure });
    const repairMsgs: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: parsed.raw.slice(0, 8000) },
      { role: "user", content: buildRepairPrompt(parsed.issues) },
    ];
    const repaired = await attemptModel(primary, repairMsgs, 1);
    const reparsed = parseCoaching(repaired.content);
    if (reparsed.ok) return finish(reparsed.value, primary, attempts);
    log.warn("hf.llm.invalid", { model: primary, attempt: attempts, failure: reparsed.failure });
  } catch (err) {
    if (err instanceof UpstreamError && err.kind === "config") return rules(attempts, `config_${err.status ?? ""}`);
    log.warn("hf.llm.primary_failed", {
      model: primary,
      attempt: attempts,
      failure: err instanceof UpstreamError ? err.kind : "error",
      status: err instanceof UpstreamError ? err.status : undefined,
    });
  }

  // Attempt 3: fallback model, fresh request.
  const fallback = env.HF_LLM_FALLBACK_MODEL;
  try {
    const out = await attemptModel(fallback, messages, 1);
    const parsed = parseCoaching(out.content);
    if (parsed.ok) return finish(parsed.value, fallback, attempts);
    return rules(attempts, parsed.failure);
  } catch (err) {
    return rules(attempts, err instanceof UpstreamError ? err.kind : "error");
  }
}
