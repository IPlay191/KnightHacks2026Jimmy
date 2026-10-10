import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed identity token: `v1.<userId>.<base64url(HMAC-SHA256(secret, "v1." + userId))>`
 * (design §8). Pure functions so they can be property-tested (P12).
 */
const VERSION = "v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signIdentity(userId: string, secret: string): string {
  const payload = `${VERSION}.${userId}`;
  return `${payload}.${mac(secret, payload)}`;
}

/** Returns the user ID when the token is well-formed and authentic, else null. */
export function verifyIdentity(token: string | undefined | null, secret: string): string | null {
  if (!token || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, userId, signature] = parts as [string, string, string];
  if (version !== VERSION || !UUID_RE.test(userId)) return null;
  const expected = Buffer.from(mac(secret, `${version}.${userId}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? userId : null;
}

/** HMAC of a client IP so raw IPs are never stored (NFR-2.6, R17.4). */
export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(`ip:${ip}`).digest("base64url").slice(0, 32);
}

/** Short, non-reversible user reference for logs. */
export function hashUserId(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`uid:${userId}`).digest("base64url").slice(0, 12);
}
