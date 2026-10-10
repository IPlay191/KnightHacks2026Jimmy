import type { ReactNode } from "react";
import { GuestGate } from "@/components/layout/GuestGate";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { TopNav } from "@/components/layout/TopNav";
import { MotionPreferenceSync } from "@/components/motion/MotionPreferenceSync";
import { RecordingSessionProvider } from "@/components/studio/RecordingSessionProvider";
import { getCurrentUser } from "@/server/auth/identity";
import { getUserSettings } from "@/server/db/queries/users";
import { getEnv } from "@/server/env";

/**
 * Shared layout for studio, sessions, history, and settings. Resolves the
 * guest identity and keeps in-memory recordings alive across client
 * navigation (design §10.1).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <TopNav showLinks={false} />
        <GuestGate demoSamples={getEnv().DEMO_SEED_ON_GUEST} />
      </>
    );
  }
  const settings = await getUserSettings(user.id);
  return (
    <RecordingSessionProvider>
      <MotionPreferenceSync preference={settings.motionPreference} />
      <TopNav />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1200px] px-4 py-8 outline-none sm:px-6 sm:py-10">
        {children}
      </main>
      <SiteFooter />
    </RecordingSessionProvider>
  );
}
