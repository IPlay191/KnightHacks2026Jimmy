"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";
import { getCurrentUser, setIdentityCookie } from "@/server/auth/identity";
import { hashIp } from "@/server/auth/token";
import { countGuestsFromIpSince, createGuestUser } from "@/server/db/queries/users";
import { hasSampleSessions, newestSampleSessionId } from "@/server/db/queries/sessions";
import { cloneSampleSessions } from "@/server/pipeline/clone-samples";

export interface GuestActionState {
  error: string | null;
}

/**
 * Creates (or reuses) a guest profile, optionally cloning the sample history,
 * sets the signed identity cookie, and redirects (R1.2–1.5, design §8).
 */
export async function continueAsGuest(_prev: GuestActionState, formData: FormData): Promise<GuestActionState> {
  const next = formData.get("next") === "sample" ? "sample" : "studio";
  // When the form offers the sample-history checkbox, honor it; otherwise default to samples.
  const withSamples = formData.has("samplesChoice") ? formData.get("withSamples") === "on" : true;
  const returnTo = String(formData.get("returnTo") ?? "");
  const env = getEnv();

  let userId: string;
  const existing = await getCurrentUser();
  if (existing) {
    userId = existing.id;
  } else {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
    const ipHash = hashIp(ip, env.SESSION_SECRET);
    try {
      const recent = await countGuestsFromIpSince(ipHash, new Date(Date.now() - 60 * 60 * 1000));
      if (recent >= env.GUEST_LIMIT_PER_HOUR) {
        return { error: "Too many new profiles from this network. Please try again in an hour." };
      }
      userId = await createGuestUser(ipHash);
      if (env.DEMO_SEED_ON_GUEST && withSamples) {
        await cloneSampleSessions(userId).catch((err: unknown) => {
          log.warn("guest.clone_samples_failed", { detail: err instanceof Error ? err.message.slice(0, 200) : undefined });
        });
      }
    } catch (err) {
      log.error("guest.create_failed", { detail: err instanceof Error ? err.message.slice(0, 200) : undefined });
      return { error: "We couldn't set up your profile. Please try again." };
    }
  }
  await setIdentityCookie(userId);

  if (next === "sample") {
    const sampleId = (await hasSampleSessions(userId)) ? await newestSampleSessionId(userId) : null;
    redirect(sampleId ? `/sessions/${sampleId}` : "/studio");
  }
  // Only allow same-site relative paths for the post-gate return.
  if (/^\/(studio|history|settings|sessions\/[0-9a-f-]{36}(\/processing)?)$/.test(returnTo)) redirect(returnTo);
  redirect("/studio");
}
