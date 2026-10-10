"use client";

import { forwardRef, useEffect, useState } from "react";
import { VideoOff } from "lucide-react";
import { buildVtt } from "@/lib/vtt";

/**
 * Same-tab video replay with captions generated from the transcript
 * (R11.2, R11.4, R16.11). Video never leaves the device.
 */
export const LocalReplay = forwardRef<
  HTMLVideoElement,
  { videoUrl: string | null; segments: { startMs: number; endMs: number; text: string }[] }
>(function LocalReplay({ videoUrl, segments }, ref) {
  const [vttUrl, setVttUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!videoUrl) return;
    const url = URL.createObjectURL(new Blob([buildVtt(segments)], { type: "text/vtt" }));
    setVttUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoUrl, segments]);

  if (!videoUrl) {
    return (
      <p className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-raised px-4 py-3 text-small text-text-secondary">
        <VideoOff aria-hidden="true" size={18} /> Video is kept only on your device during the session.
      </p>
    );
  }
  return (
    <video ref={ref} controls playsInline className="w-full rounded-lg bg-canvas" aria-label="Replay of your recording">
      <source src={videoUrl} />
      {vttUrl ? <track kind="captions" srcLang="en" label="English" src={vttUrl} default /> : null}
    </video>
  );
});
