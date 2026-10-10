import "server-only";
import { NextResponse } from "next/server";
import { ERROR_CATALOG } from "@/lib/errors";
import { getEnv } from "@/server/env";
import { AppError, isAppError } from "@/server/errors";
import { log } from "@/server/log";

const NO_STORE = { "Cache-Control": "no-store" };

export function json<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

/** Mutating requests must come from our own origin (CSRF defense, NFR-2.4). */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  const allowed = getEnv().APP_ORIGIN;
  if (!origin) throw new AppError("FORBIDDEN_ORIGIN");
  if (origin === allowed) return;
  // Also accept the request's own host (preview deployments, localhost ports).
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host && new URL(origin).host === host) return;
  } catch {
    // fall through
  }
  throw new AppError("FORBIDDEN_ORIGIN");
}

/** True for errors from the database driver or network to Neon. */
function isDatabaseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name ?? "";
  const msg = err.message ?? "";
  return (
    name === "NeonDbError" ||
    /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Error connecting to database|NeonDbError/i.test(msg)
  );
}

export function toErrorResponse(err: unknown, context: { route: string; sessionId?: string }): NextResponse {
  let appErr: AppError;
  if (isAppError(err)) {
    appErr = err;
  } else if (isDatabaseError(err)) {
    appErr = new AppError("SERVICE_UNAVAILABLE", { cause: err });
  } else {
    appErr = new AppError("INTERNAL", { cause: err });
  }
  const level = ERROR_CATALOG[appErr.code].level;
  const stack = !isAppError(err) && err instanceof Error ? err.stack?.split("\n").slice(0, 6).join(" | ") : undefined;
  log[level](`api.${context.route}`, {
    code: appErr.code,
    status: appErr.status,
    sessionId: context.sessionId,
    detail: !isAppError(err) && err instanceof Error ? err.message.slice(0, 200) : undefined,
    stack,
  });
  const headers: Record<string, string> = { ...NO_STORE };
  if (appErr.retryAfterSec) headers["Retry-After"] = String(appErr.retryAfterSec);
  return NextResponse.json(appErr.toEnvelope(), { status: appErr.status, headers });
}

/** Reads a JSON body with a size cap (16 KB, design §9.8). */
export async function readJson(req: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE");
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE");
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("VALIDATION_FAILED", { message: "The request body isn't valid JSON." });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Invalid IDs are reported as NOT_FOUND so probing reveals nothing (design §9.8). */
export function parseSessionId(id: string): string {
  if (!UUID_RE.test(id)) throw new AppError("NOT_FOUND");
  return id.toLowerCase();
}
