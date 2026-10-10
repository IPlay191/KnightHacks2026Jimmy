import "server-only";
import { AUDIENCE_PROFILE_VERSION } from "@/lib/audience";
import { CreateSessionBody, fieldErrorsFrom } from "@/lib/validation";
import { AppError } from "@/server/errors";
import { countRecentSessions, insertSession } from "@/server/db/queries/sessions";

const DAILY_LIMIT = 25;

/** Validates and creates a practice session (design §9.1, NFR-2.6). */
export async function createSession(userId: string, body: unknown): Promise<{ sessionId: string }> {
  const parsed = CreateSessionBody.safeParse(body);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: fieldErrorsFrom(parsed.error) });
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if ((await countRecentSessions(userId, since)) >= DAILY_LIMIT) {
    throw new AppError("RATE_LIMITED", { retryAfterSec: 3600 });
  }
  const b = parsed.data;
  const sessionId = await insertSession({
    userId,
    title: b.title,
    goal: b.goal,
    durationMs: b.durationMs,
    expectedChunks: b.expectedChunks,
    videoCaptured: b.videoCaptured,
    timeZone: b.timeZone,
    audience: b.audience,
    audienceProfileVersion: AUDIENCE_PROFILE_VERSION,
  });
  return { sessionId };
}
