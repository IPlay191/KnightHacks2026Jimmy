"use server";

import { revalidatePath } from "next/cache";
import { fieldErrorsFrom, SettingsInput } from "@/lib/validation";
import { requireUser } from "@/server/auth/identity";
import { saveUserSettings } from "@/server/db/queries/users";
import { isAppError } from "@/server/errors";

export type SettingsResult = { ok: true } | { ok: false; fieldErrors: Record<string, string> };

/** Validates and saves settings (R13.1, R13.2, R13.6, R20.1). */
export async function updateSettings(input: unknown): Promise<SettingsResult> {
  try {
    const user = await requireUser();
    const parsed = SettingsInput.safeParse(input);
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
    await saveUserSettings(user.id, parsed.data);
    revalidatePath("/settings");
    revalidatePath("/studio");
    return { ok: true };
  } catch (err) {
    if (isAppError(err) && err.code === "UNAUTHENTICATED") {
      return { ok: false, fieldErrors: { form: "Your guest session expired. Reload the page to continue." } };
    }
    return { ok: false, fieldErrors: { form: "We couldn't save your settings. Please try again." } };
  }
}
