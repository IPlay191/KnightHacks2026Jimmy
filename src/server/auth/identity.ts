import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/errors";
import { findUserForAuth, touchLastSeen, type AuthUser } from "@/server/db/queries/users";
import { signIdentity, verifyIdentity } from "./token";

export const IDENTITY_COOKIE = "sr_uid";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days (NFR-2.4)
const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SEC,
    secure: process.env.NODE_ENV === "production",
  };
}

/** Sets the signed identity cookie. Valid in Route Handlers and Server Actions only. */
export async function setIdentityCookie(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(IDENTITY_COOKIE, signIdentity(userId, getEnv().SESSION_SECRET), cookieOptions());
}

export async function clearIdentityCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(IDENTITY_COOKIE);
}

async function readUserFromCookie(): Promise<AuthUser | null> {
  const jar = await cookies();
  const userId = verifyIdentity(jar.get(IDENTITY_COOKIE)?.value, getEnv().SESSION_SECRET);
  if (!userId) return null;
  return findUserForAuth(userId);
}

/** For Server Components: the current user, or null (shows the guest gate). */
export async function getCurrentUser(): Promise<AuthUser | null> {
  return readUserFromCookie();
}

/**
 * For Route Handlers and Server Actions: the current user, or throws
 * UNAUTHENTICATED. Also refreshes the cookie (sliding 30-day window) and
 * `last_seen_at` at most hourly.
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await readUserFromCookie();
  if (!user) throw new AppError("UNAUTHENTICATED");
  await setIdentityCookie(user.id);
  if (Date.now() - user.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    await touchLastSeen(user.id).catch(() => undefined);
  }
  return user;
}
