import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { userSettings, userStats, users } from "@/server/db/schema";
import type { Audience, MotionPreference } from "@/lib/types";

export interface AuthUser {
  id: string;
  displayName: string;
  kind: "guest" | "member" | "template";
  lastSeenAt: Date;
}

export async function findUserForAuth(userId: string): Promise<AuthUser | null> {
  const rows = await getDb()
    .select({ id: users.id, displayName: users.displayName, kind: users.kind, lastSeenAt: users.lastSeenAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function touchLastSeen(userId: string): Promise<void> {
  await getDb().update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
}

export async function countGuestsFromIpSince(ipHash: string, since: Date): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.createdIpHash, ipHash), gte(users.createdAt, since)));
  return rows[0]?.n ?? 0;
}

/** Inserts the user, settings, and stats rows atomically. */
export async function createGuestUser(ipHash: string | null): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(users).values({ id, kind: "guest", createdIpHash: ipHash }),
    db.insert(userSettings).values({ userId: id }),
    db.insert(userStats).values({ userId: id }),
  ]);
  return id;
}

export interface UserSettings {
  displayName: string;
  targetWpmMin: number;
  targetWpmMax: number;
  customFillers: string[];
  defaultAudience: Audience;
  motionPreference: MotionPreference;
  autoAdvanceReport: boolean;
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const rows = await getDb()
    .select({
      displayName: users.displayName,
      targetWpmMin: userSettings.targetWpmMin,
      targetWpmMax: userSettings.targetWpmMax,
      customFillers: userSettings.customFillers,
      defaultAudience: userSettings.defaultAudience,
      motionPreference: userSettings.motionPreference,
      autoAdvanceReport: userSettings.autoAdvanceReport,
    })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  return {
    displayName: row?.displayName ?? "Speaker",
    targetWpmMin: row?.targetWpmMin ?? 130,
    targetWpmMax: row?.targetWpmMax ?? 160,
    customFillers: row?.customFillers ?? [],
    defaultAudience: row?.defaultAudience ?? "general",
    motionPreference: row?.motionPreference ?? "system",
    autoAdvanceReport: row?.autoAdvanceReport ?? true,
  };
}

export async function saveUserSettings(userId: string, s: UserSettings): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.batch([
    db.update(users).set({ displayName: s.displayName }).where(eq(users.id, userId)),
    db
      .insert(userSettings)
      .values({
        userId,
        targetWpmMin: s.targetWpmMin,
        targetWpmMax: s.targetWpmMax,
        customFillers: s.customFillers,
        defaultAudience: s.defaultAudience,
        motionPreference: s.motionPreference,
        autoAdvanceReport: s.autoAdvanceReport,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          targetWpmMin: s.targetWpmMin,
          targetWpmMax: s.targetWpmMax,
          customFillers: s.customFillers,
          defaultAudience: s.defaultAudience,
          motionPreference: s.motionPreference,
          autoAdvanceReport: s.autoAdvanceReport,
          updatedAt: now,
        },
      }),
  ]);
}

/** Deletes the user; every dependent row cascades (R13.4). */
export async function deleteUserCascade(userId: string): Promise<void> {
  await getDb().delete(users).where(eq(users.id, userId));
}

export async function findTemplateUserId(): Promise<string | null> {
  const rows = await getDb().select({ id: users.id }).from(users).where(eq(users.kind, "template")).limit(1);
  return rows[0]?.id ?? null;
}
