"use client";

import { useActionState, useId } from "react";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { continueAsGuest, type GuestActionState } from "@/app/actions/guest";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/** Shown inside app pages when there's no guest identity yet (design §8). */
export function GuestGate({ demoSamples }: { demoSamples: boolean }) {
  const pathname = usePathname();
  const [state, action, pending] = useActionState<GuestActionState, FormData>(continueAsGuest, { error: null });
  const checkId = useId();
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex max-w-xl flex-col px-4 py-16 outline-none sm:px-6">
      <Card>
        <h1 className="text-h2">Continue as a guest</h1>
        <p className="mt-2 text-text-secondary">
          No sign-up needed. We create a private guest profile on this browser so your sessions and progress are saved.
        </p>
        <form action={action} className="mt-6 flex flex-col gap-4">
          <input type="hidden" name="next" value="studio" />
          <input type="hidden" name="returnTo" value={pathname} />
          {demoSamples ? (
            <div className="flex items-start gap-3">
              <input type="hidden" name="samplesChoice" value="1" />
              <input
                id={checkId}
                type="checkbox"
                name="withSamples"
                value="on"
                defaultChecked
                className="mt-1 size-5 accent-primary"
              />
              <label htmlFor={checkId} className="text-text-secondary">
                Start with a sample history so you can explore the dashboard right away
              </label>
            </div>
          ) : null}
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Setting up…" : "Continue as guest"}
          </Button>
          {state.error ? (
            <p role="alert" className="text-danger">
              {state.error}
            </p>
          ) : null}
        </form>
        <p className="mt-6 flex items-start gap-2 text-small text-text-muted">
          <ShieldCheck aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
          Video stays on your device. Audio is sent for transcription and isn&apos;t stored. Transcripts and scores are
          saved so you can track progress, and you can delete them anytime.
        </p>
      </Card>
    </main>
  );
}
