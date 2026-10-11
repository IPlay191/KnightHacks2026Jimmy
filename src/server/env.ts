import "server-only";
import { z } from "zod";

/**
 * Validated server environment (design §15, NFR-2.1). Parsed lazily on first
 * use so `next build` can run without secrets, and cached afterwards.
 * Nothing here may ever be sent to the browser.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    HF_TOKEN: z.string().optional(),
    HF_ASR_MODEL: z.string().min(1).default("openai/whisper-large-v3-turbo"),
    HF_ASR_FALLBACK_MODEL: z.string().min(1).default("openai/whisper-large-v3"),
    HF_LLM_MODEL: z.string().min(1).default("meta-llama/Llama-3.3-70B-Instruct"),
    HF_LLM_FALLBACK_MODEL: z.string().min(1).default("meta-llama/Llama-3.1-8B-Instruct"),
    HF_MOCK: z
      .string()
      .optional()
      .transform((v) => v === "1" || v === "true"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    APP_ORIGIN: z
      .string()
      .url()
      .transform((v) => v.replace(/\/+$/, "")),
    DEMO_SEED_ON_GUEST: z
      .string()
      .optional()
      .transform((v) => v === "1" || v === "true"),
    /** Guest profiles one IP may create per hour. E2E raises it; production keeps the default. */
    GUEST_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(10),
  })
  .superRefine((env, ctx) => {
    if (env.HF_MOCK && env.VERCEL_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["HF_MOCK"], message: "HF_MOCK must not be enabled in production" });
    }
    if (!env.HF_MOCK && !env.HF_TOKEN) {
      ctx.addIssue({ code: "custom", path: ["HF_TOKEN"], message: "HF_TOKEN is required unless HF_MOCK=1" });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Read and validate the environment. Throws with key names only (never values). */
export function getEnv(): Env {
  if (cached) return cached;
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment: ${problems}`);
  }
  cached = result.data;
  return cached;
}

/** Test helper: forget the cached environment. */
export function resetEnvCache(): void {
  cached = null;
}
