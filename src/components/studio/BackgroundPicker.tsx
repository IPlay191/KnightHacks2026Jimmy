"use client";

import Image from "next/image";
import { RadioGroup } from "radix-ui";
import { Check, VideoOff } from "lucide-react";
import { useId } from "react";
import { BACKGROUND_IDS, BACKGROUNDS, type BackgroundId } from "@/lib/studio/backgrounds";
import type { BackgroundStatus } from "@/lib/studio/useCameraBackground";

/**
 * Virtual background choice for the camera. A labelled radio group (arrow keys
 * move the selection); the selected card gets a check icon and thicker outline,
 * not just a color change.
 */
export function BackgroundPicker({
  value,
  onChange,
  disabled,
  status,
}: {
  value: BackgroundId;
  onChange: (id: BackgroundId) => void;
  disabled?: boolean;
  status: BackgroundStatus;
}) {
  const base = useId();
  const legendId = `${base}-legend`;
  const hintId = `${base}-hint`;
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend id={legendId} className="sr-only">
        Camera background
      </legend>
      <p id={hintId} className="text-caption text-text-secondary">
        Applied on your device. Your video never leaves the browser.
      </p>
      <RadioGroup.Root
        aria-labelledby={legendId}
        aria-describedby={hintId}
        value={value}
        onValueChange={(v) => onChange(v as BackgroundId)}
        className="grid grid-cols-2 gap-2"
        disabled={disabled}
      >
        {BACKGROUND_IDS.map((id) => {
          const scene = BACKGROUNDS[id];
          const selected = value === id;
          const descId = `${base}-${id}-desc`;
          return (
            <RadioGroup.Item
              key={id}
              value={id}
              aria-describedby={descId}
              data-testid={`background-${id}`}
              className={`group relative flex flex-col overflow-hidden rounded-md border bg-surface-raised text-left transition-colors hover:border-primary-soft disabled:cursor-not-allowed disabled:opacity-70 ${
                selected ? "border-2 border-primary-soft" : "border-border-strong"
              }`}
            >
              {scene.src ? (
                <Image
                  src={scene.src}
                  alt=""
                  width={160}
                  height={90}
                  unoptimized
                  className="aspect-video w-full object-cover"
                />
              ) : (
                <span className="flex aspect-video w-full items-center justify-center bg-canvas text-text-muted">
                  <VideoOff aria-hidden="true" size={22} />
                </span>
              )}
              <span className="flex flex-col px-2 py-1.5">
                <span className="text-small font-semibold text-text">{scene.label}</span>
                <span id={descId} className="text-caption text-text-secondary">
                  {scene.description}
                </span>
              </span>
              <RadioGroup.Indicator className="absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-primary text-on-primary">
                <Check aria-hidden="true" size={14} strokeWidth={3} />
              </RadioGroup.Indicator>
            </RadioGroup.Item>
          );
        })}
      </RadioGroup.Root>
      {status === "error" ? (
        <p role="alert" className="text-small text-warning">
          Backgrounds couldn&apos;t load on this device, so your real camera is shown and recorded.
        </p>
      ) : null}
    </fieldset>
  );
}
