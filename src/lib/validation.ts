import { z } from "zod";
import { AUDIENCES, MOTION_PREFS } from "./types";

/** Input validation shared by API routes, Server Actions, and forms (design §9.8). */
export const MAX_CHUNK_SPAN_MS = 28_500;
export const MAX_CHUNKS = 17;
export const MIN_DURATION_MS = 10_000;
export const MAX_DURATION_MS = 330_000;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const optionalText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .nullish()
    .transform((v) => {
      const t = (v ?? "").replace(CONTROL_CHARS, "").trim();
      return t.length ? t : null;
    })
    .refine((v) => v === null || v.length <= max, { message: `Must be ${max} characters or fewer` });

export function normalizeTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export const CreateSessionBody = z
  .object({
    title: optionalText(80),
    goal: optionalText(200),
    durationMs: z.number().int().min(MIN_DURATION_MS).max(MAX_DURATION_MS),
    expectedChunks: z.number().int().min(1).max(MAX_CHUNKS),
    videoCaptured: z.boolean(),
    timeZone: z.unknown().transform(normalizeTimeZone),
    audience: z.enum(AUDIENCES).default("general"),
  })
  .refine((b) => b.expectedChunks >= Math.ceil(b.durationMs / MAX_CHUNK_SPAN_MS), {
    message: "expectedChunks is too small for this duration",
    path: ["expectedChunks"],
  });
export type CreateSessionBody = z.infer<typeof CreateSessionBody>;

export const CUSTOM_FILLER_RE = /^[a-zA-Z' ]{1,24}$/;

export const SettingsInput = z
  .object({
    displayName: z.string().trim().min(1, "Enter a name").max(40, "Use 40 characters or fewer"),
    defaultAudience: z.enum(AUDIENCES, { message: "Choose an audience" }),
    targetWpmMin: z.coerce
      .number({ message: "Enter a number" })
      .int("Use a whole number")
      .min(80, "Minimum is 80")
      .max(200, "Maximum is 200"),
    targetWpmMax: z.coerce
      .number({ message: "Enter a number" })
      .int("Use a whole number")
      .min(100, "Minimum is 100")
      .max(220, "Maximum is 220"),
    customFillers: z
      .array(z.string())
      .max(20, "Use 20 filler words or fewer")
      .transform((items) => items.map((s) => s.trim().toLowerCase().replace(/\s+/g, " ")).filter((s) => s.length > 0)),
    motionPreference: z.enum(MOTION_PREFS, { message: "Choose a motion setting" }),
    autoAdvanceReport: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.targetWpmMin >= v.targetWpmMax) {
      ctx.addIssue({ code: "custom", path: ["targetWpmMax"], message: "Must be greater than the minimum" });
    }
    v.customFillers.forEach((f, i) => {
      if (!CUSTOM_FILLER_RE.test(f)) {
        ctx.addIssue({
          code: "custom",
          path: ["customFillers"],
          message: `Filler ${i + 1} can use only letters, spaces, and apostrophes (1–24 characters)`,
        });
      }
    });
  })
  .transform((v) => ({ ...v, customFillers: [...new Set(v.customFillers)] }));
export type SettingsInput = z.infer<typeof SettingsInput>;

/** Field-keyed messages, first error per field. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
