"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearIdentityCookie, requireUser } from "@/server/auth/identity";
import { deleteUserCascade } from "@/server/db/queries/users";
import { deleteSampleSessions } from "@/server/db/queries/sessions";
import { log } from "@/server/log";

export type DataResult = { ok: true; removed?: number } | { ok: false; error: string };

/** Removes all sample sessions and recomputes stats (R13.5, R13.7). */
export async function removeSampleSessions(): Promise<DataResult> {
  try {
    const user = await requireUser();
    const removed = await deleteSampleSessions(user.id);
    revalidatePath("/history");
    revalidatePath("/settings");
    return { ok: true, removed };
  } catch (err) {
    log.error("data.remove_samples_failed", { detail: err instanceof Error ? err.message.slice(0, 200) : undefined });
    return { ok: false, error: "Couldn't remove sample sessions. Try again." };
  }
}

/** Deletes the user and every dependent row, clears the cookie, goes home (R13.4). */
export async function deleteAllMyData(confirm: string): Promise<DataResult> {
  if (confirm !== "DELETE") return { ok: false, error: "Type DELETE to confirm." };
  try {
    const user = await requireUser();
    await deleteUserCascade(user.id);
    await clearIdentityCookie();
  } catch (err) {
    log.error("data.delete_all_failed", { detail: err instanceof Error ? err.message.slice(0, 200) : undefined });
    return { ok: false, error: "Couldn't delete your data. Try again." };
  }
  redirect("/");
}
