import { Gauge, Mic, MessageSquareQuote, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Hero } from "@/components/landing/Hero";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { TopNav } from "@/components/layout/TopNav";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/server/auth/identity";
import { hasSampleSessions } from "@/server/db/queries/sessions";
import { findTemplateUserId } from "@/server/db/queries/users";
import { getEnv } from "@/server/env";

const STEPS = [
  { icon: Mic, title: "Record", body: "Pick your audience, then speak for 10 seconds to 5 minutes with your camera and mic." },
  { icon: Gauge, title: "Measure", body: "Whisper transcribes your speech and we measure pace, pauses, and filler words." },
  { icon: Sparkles, title: "Coach", body: "An open-source Llama model reviews clarity, structure, and audience fit." },
  { icon: MessageSquareQuote, title: "Improve", body: "Get three specific fixes, quotes from your own words, and a practice drill." },
];

/** Whether to offer "See a sample report" (R1.4). */
async function sampleAvailable(): Promise<boolean> {
  // Reading cookies stays outside try/catch so Next can detect dynamic rendering.
  const user = await getCurrentUser();
  if (!getEnv().DEMO_SEED_ON_GUEST) return false;
  try {
    if (user) return await hasSampleSessions(user.id);
    return (await findTemplateUserId()) !== null;
  } catch {
    return false;
  }
}

export default async function LandingPage() {
  const showSample = await sampleAvailable();
  return (
    <>
      <TopNav />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero showSample={showSample} />
        <section aria-labelledby="how-heading" className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
          <h2 id="how-heading" className="text-h2">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title}>
                <Card as="div" className="h-full">
                  <span className="text-caption text-text-muted">Step {i + 1}</span>
                  <h3 className="mt-1 flex items-center gap-2 text-h3">
                    <Icon aria-hidden="true" size={20} className="text-primary-soft" /> {title}
                  </h3>
                  <p className="mt-2 text-text-secondary">{body}</p>
                </Card>
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="aud-heading" className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
          <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Users aria-hidden="true" className="shrink-0 text-primary-soft" size={32} />
            <div>
              <h2 id="aud-heading" className="text-h3">
                Graded for your audience
              </h2>
              <p className="mt-1 text-text-secondary">
                Speaking to kids, teens, or seniors? Pick your audience and your pace targets, vocabulary level, and
                coaching adapt to what works for them.
              </p>
            </div>
          </Card>
        </section>
        <section aria-labelledby="privacy-heading" className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
          <Card>
            <h2 id="privacy-heading" className="flex items-center gap-2 text-h3">
              <ShieldCheck aria-hidden="true" className="text-success" /> What we capture, and where it goes
            </h2>
            <ul className="mt-4 grid gap-3 text-text-secondary sm:grid-cols-3">
              <li>
                <strong className="text-text">Video stays on your device.</strong> It&apos;s used for your self-view and an
                instant replay, and it&apos;s never uploaded.
              </li>
              <li>
                <strong className="text-text">Audio is sent for transcription and not stored.</strong> It goes to an
                open-source Whisper model on Hugging Face and is discarded afterward.
              </li>
              <li>
                <strong className="text-text">Transcripts and scores are stored</strong> in your private guest profile so
                you can track progress. Delete them anytime.
              </li>
            </ul>
          </Card>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
