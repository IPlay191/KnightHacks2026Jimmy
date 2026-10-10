/**
 * Warm-up and smoke test for Hugging Face (R18.2, task 4.1). Sends one short
 * ASR request and one chat request with the real HF_TOKEN, and reports
 * status, latency, and response shape (never the token).
 *
 * Usage: pnpm warmup
 */
import { config } from "dotenv";
import { encodeWavPcm16 } from "@/lib/audio/wav";

config({ path: ".env.local", quiet: true });

const token = process.env.HF_TOKEN;
const asrModel = process.env.HF_ASR_MODEL || "openai/whisper-large-v3-turbo";
const llmModel = process.env.HF_LLM_MODEL || "meta-llama/Llama-3.3-70B-Instruct";
const llmFallback = process.env.HF_LLM_FALLBACK_MODEL || "meta-llama/Llama-3.1-8B-Instruct";
const ROUTER = "https://router.huggingface.co";

function tone(seconds: number): Float32Array {
  const rate = 16000;
  const out = new Float32Array(seconds * rate);
  for (let i = 0; i < out.length; i++) {
    // A rough voiced signal (amplitude-modulated harmonics) so the model has something to decode.
    const env = 0.5 + 0.5 * Math.sin((2 * Math.PI * 3 * i) / rate);
    out[i] = 0.25 * env * (Math.sin((2 * Math.PI * 180 * i) / rate) + 0.5 * Math.sin((2 * Math.PI * 360 * i) / rate));
  }
  return out;
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  const started = Date.now();
  try {
    const r = await fn();
    console.log(`✔ ${label} (${Date.now() - started} ms)`);
    return r;
  } catch (err) {
    console.log(`✘ ${label} (${Date.now() - started} ms): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function asr() {
  const wav = encodeWavPcm16(tone(3));
  const res = await fetch(`${ROUTER}/hf-inference/models/${asrModel}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: Buffer.from(wav).toString("base64"), parameters: { return_timestamps: true } }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = (await res.json().catch(() => null)) as { text?: string; chunks?: unknown[]; error?: string } | null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body?.error ?? ""}`.trim());
  console.log(`  ASR shape: text=${typeof body?.text}, chunks=${Array.isArray(body?.chunks) ? body?.chunks.length : "none"}`);
  return body;
}

async function chat(model: string, withSchema: boolean) {
  const res = await fetch(`${ROUTER}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: 'Reply with the JSON object {"ok": true} and nothing else.' }],
      max_tokens: 20,
      temperature: 0,
      ...(withSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "ok",
                schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
                strict: true,
              },
            },
          }
        : {}),
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: unknown } | null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(body?.error ?? "").slice(0, 160)}`);
  console.log(`  reply: ${JSON.stringify(body?.choices?.[0]?.message?.content ?? "").slice(0, 80)}`);
  return body;
}

async function main() {
  if (!token) {
    console.error("HF_TOKEN is not set. Add it to .env.local (it's never printed).");
    process.exit(1);
  }
  console.log(`Warming up ${asrModel}, ${llmModel}, and ${llmFallback}…`);
  const a = await timed(`ASR ${asrModel}`, asr);
  const b = await timed(`Chat ${llmModel} with json_schema`, () => chat(llmModel, true));
  if (!b) await timed(`Chat ${llmModel} without response_format`, () => chat(llmModel, false));
  const c = await timed(`Chat ${llmFallback}`, () => chat(llmFallback, false));
  process.exit(a && (b || c) ? 0 : 1);
}

void main();
