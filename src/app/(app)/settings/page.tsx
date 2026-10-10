import type { Metadata } from "next";
import { DangerZone } from "@/components/settings/DangerZone";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { getCurrentUser } from "@/server/auth/identity";
import { hasSampleSessions } from "@/server/db/queries/sessions";
import { getUserSettings } from "@/server/db/queries/users";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [settings, samples] = await Promise.all([getUserSettings(user.id), hasSampleSessions(user.id)]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="text-h1">Settings</h1>
        <p className="mt-2 text-text-secondary">Tune your targets, audience, and motion, and control your data.</p>
      </div>
      <SettingsForm initial={settings} />
      <DangerZone hasSamples={samples} />
    </div>
  );
}
