"use client";

import { forwardRef, useMemo } from "react";
import { Camera, Lock, Mic, MonitorX, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { DeniedReason, UnsupportedReason } from "@/lib/studio/machine";
import { detectBrowser, RECOVERY_STEPS } from "@/lib/studio/media";

/** Pre-permission explainer (R2.1, R1.6). */
export const PermissionExplainer = forwardRef<HTMLHeadingElement, { onEnable: () => void; waiting: boolean }>(
  function PermissionExplainer({ onEnable, waiting }, ref) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h2 ref={ref} tabIndex={-1} className="text-h2 outline-none">
          {waiting ? "Waiting for your browser…" : "Let's set up your camera and microphone"}
        </h2>
        <p className="mt-2 text-text-secondary">
          {waiting
            ? "Your browser is asking for permission. Choose Allow to continue."
            : "Your browser will ask for permission next. Here's why we need each one and what happens to your data."}
        </p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          <li className="flex gap-3 rounded-md border border-border-subtle bg-surface-raised p-4">
            <Mic aria-hidden="true" className="mt-0.5 shrink-0 text-primary-soft" />
            <div>
              <h3 className="font-semibold">Microphone</h3>
              <p className="text-small text-text-secondary">
                Needed to analyze your pace, pauses, and words. Audio is sent for transcription and isn&apos;t stored.
              </p>
            </div>
          </li>
          <li className="flex gap-3 rounded-md border border-border-subtle bg-surface-raised p-4">
            <Camera aria-hidden="true" className="mt-0.5 shrink-0 text-primary-soft" />
            <div>
              <h3 className="font-semibold">Camera</h3>
              <p className="text-small text-text-secondary">
                For your self-view and instant replay. Video never leaves this device.
              </p>
            </div>
          </li>
        </ul>
        <p className="mt-4 flex items-start gap-2 text-small text-text-muted">
          <ShieldCheck aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
          Transcripts and scores are saved to your private guest profile. You can delete them anytime in Settings.
        </p>
        <div className="mt-6">
          <Button size="lg" onClick={onEnable} disabled={waiting} data-testid="enable-media">
            {waiting ? "Waiting for your browser…" : "Enable camera & mic"}
          </Button>
        </div>
      </Card>
    );
  },
);

const DENIED_COPY: Record<DeniedReason, { title: string; body: string }> = {
  "not-allowed": {
    title: "Camera and microphone are blocked",
    body: "Your browser blocked access. You can allow it in your browser settings, or continue with your microphone only.",
  },
  "not-found-camera": {
    title: "No camera found",
    body: "We couldn't find a camera. You can still practice with your microphone only.",
  },
  "not-found-mic": {
    title: "No microphone found",
    body: "We couldn't find a microphone, so recording isn't possible. Connect a microphone and try again.",
  },
  "not-readable": {
    title: "Your camera or microphone is busy",
    body: "Another app may be using it. Close other apps that use your camera or microphone (video calls, recorders), then try again.",
  },
  overconstrained: {
    title: "Your device settings aren't supported",
    body: "We couldn't start your camera with the requested settings. Try again or switch to a different camera.",
  },
};

/** Recovery panel for denied, missing, or busy devices (R2.4–2.7). */
export const PermissionRecovery = forwardRef<
  HTMLHeadingElement,
  { reason: DeniedReason; canUseMicOnly: boolean; onRetry: () => void; onMicOnly: () => void }
>(function PermissionRecovery({ reason, canUseMicOnly, onRetry, onMicOnly }, ref) {
  const copy = DENIED_COPY[reason];
  const steps = useMemo(() => RECOVERY_STEPS[detectBrowser()], []);
  return (
    <Card className="mx-auto max-w-2xl" data-testid="permission-recovery">
      <div role="alert">
        <h2 ref={ref} tabIndex={-1} className="flex items-center gap-2 text-h2 outline-none">
          <Lock aria-hidden="true" className="text-warning" /> {copy.title}
        </h2>
        <p className="mt-2 text-text-secondary">{copy.body}</p>
      </div>
      {reason === "not-allowed" ? (
        <div className="mt-6">
          <h3 className="font-semibold">How to allow access</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-6 text-text-secondary">
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={onRetry} icon={<RefreshCw size={18} />}>
          Try again
        </Button>
        {canUseMicOnly && reason !== "not-found-mic" ? (
          <Button variant="secondary" onClick={onMicOnly} icon={<Mic size={18} />}>
            Continue with microphone only
          </Button>
        ) : null}
      </div>
    </Card>
  );
});

const UNSUPPORTED_COPY: Record<UnsupportedReason, string> = {
  insecure: "Recording needs a secure (HTTPS) connection. Open this page using https:// to continue.",
  "no-media": "This browser can't access a camera or microphone. Try the latest Chrome, Edge, Firefox, or Safari.",
  "no-worklet": "This browser can't record audio here. Try the latest Chrome, Edge, Firefox, or Safari.",
};

export const UnsupportedPanel = forwardRef<HTMLHeadingElement, { reason: UnsupportedReason }>(function UnsupportedPanel(
  { reason },
  ref,
) {
  return (
    <Card className="mx-auto max-w-2xl">
      <div role="alert">
        <h2 ref={ref} tabIndex={-1} className="flex items-center gap-2 text-h2 outline-none">
          <MonitorX aria-hidden="true" className="text-warning" /> Recording isn&apos;t available
        </h2>
        <p className="mt-2 text-text-secondary">{UNSUPPORTED_COPY[reason]}</p>
      </div>
    </Card>
  );
});
