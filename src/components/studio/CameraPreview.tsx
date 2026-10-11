"use client";

import { useEffect, useRef } from "react";
import { Loader2, MicVocal } from "lucide-react";
import type { BackgroundStatus } from "@/lib/studio/useCameraBackground";


/**
 * Mirrored live self-view (R3.1). Audio-only mode shows a placeholder. With a
 * virtual background, a canvas (already mirrored by the compositor) covers the
 * raw video once the effect is running.
 */
export function CameraPreview({
  stream,
  audioOnly,
  backgroundStatus = "off",
  backgroundLabel = "",
  attachBackground,
}: {
  stream: MediaStream | null;
  audioOnly: boolean;
  backgroundStatus?: BackgroundStatus;
  /** Scene name for the accessible label, e.g. "Office". */
  backgroundLabel?: string;
  attachBackground?: (el: HTMLCanvasElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream && !audioOnly ? stream : null;
    if (stream && !audioOnly) void el.play().catch(() => undefined);
  }, [stream, audioOnly]);

  if (audioOnly || !stream || stream.getVideoTracks().length === 0) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-gradient-to-br from-surface-raised to-canvas text-text-secondary">
        <MicVocal aria-hidden="true" size={48} className="text-primary-soft" />
        <p>{stream ? "Microphone only. Your camera is off." : "Camera preview appears here."}</p>
      </div>
    );
  }

  const status = backgroundStatus;
  const showCanvas = status === "on" || status === "loading";
  const on = status === "on";
  return (
    <div className="relative">
      <video
        ref={ref}
        muted
        playsInline
        aria-label="Your camera preview (mirrored)"
        aria-hidden={on ? true : undefined}
        className="aspect-video w-full -scale-x-100 rounded-xl bg-canvas object-cover"
      />
      {showCanvas && attachBackground ? (
        <canvas
          ref={attachBackground}
          role="img"
          aria-label={`Your camera preview with the ${backgroundLabel} background (mirrored)`}
          aria-hidden={on ? undefined : true}
          data-testid="background-canvas"
          data-status={status}
          className={`absolute inset-0 h-full w-full rounded-xl object-cover ${on ? "" : "invisible"}`}
        />
      ) : null}
      {status === "loading" ? (
        <p
          role="status"
          className="absolute bottom-3 right-3 flex items-center gap-2 rounded-md border border-border-strong bg-canvas/90 px-3 py-1.5 text-small text-text"
        >
          <Loader2 aria-hidden="true" size={16} className="motion-safe:animate-spin" /> Loading background…
        </p>
      ) : null}
    </div>
  );
}
