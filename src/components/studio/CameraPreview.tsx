"use client";

import { useEffect, useRef } from "react";
import { MicVocal } from "lucide-react";

/** Mirrored live self-view (R3.1). Audio-only mode shows a placeholder. */
export function CameraPreview({ stream, audioOnly }: { stream: MediaStream | null; audioOnly: boolean }) {
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
  return (
    <video
      ref={ref}
      muted
      playsInline
      aria-label="Your camera preview (mirrored)"
      className="aspect-video w-full -scale-x-100 rounded-xl bg-canvas object-cover"
    />
  );
}
