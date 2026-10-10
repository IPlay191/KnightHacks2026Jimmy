"use client";

import { forwardRef, useRef } from "react";
import { gsap, registerGsap, useGSAP } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";
import { dur, ease } from "@/components/motion/tokens";

export type RecordMode = "ready" | "countdown" | "recording";

const CIRCLE =
  "M36 14 C48.15 14 58 23.85 58 36 C58 48.15 48.15 58 36 58 C23.85 58 14 48.15 14 36 C14 23.85 23.85 14 36 14 Z";
const SQUARE =
  "M29 23 H43 C46.31 23 49 25.69 49 29 V43 C49 46.31 46.31 49 43 49 H29 C25.69 49 23 46.31 23 43 V29 C23 25.69 25.69 23 29 23 Z";

export const RECORD_LABELS: Record<RecordMode, string> = {
  ready: "Start recording",
  countdown: "Cancel",
  recording: "Stop recording",
};

/**
 * The single primary studio control (R4.1, R16.4, R16.9). Its accessible name
 * is its visible label. GSAP morphs circle ↔ rounded square (R15.3).
 */
export const RecordControl = forwardRef<HTMLButtonElement, { mode: RecordMode; onPress: () => void; disabled?: boolean }>(
  function RecordControl({ mode, onPress, disabled }, ref) {
    const root = useRef<HTMLDivElement>(null);
    const { reduced } = useMotion();
    const live = mode === "recording";

    useGSAP(
      () => {
        registerGsap();
        const shape = root.current?.querySelector<SVGPathElement>("[data-shape]");
        const halo = root.current?.querySelector<SVGCircleElement>("[data-halo]");
        if (!shape) return;
        const target = live ? SQUARE : CIRCLE;
        if (reduced) {
          gsap.set(shape, { morphSVG: target });
        } else {
          gsap.to(shape, { morphSVG: target, duration: dur.slow, ease: ease.springy });
          gsap.fromTo(root.current, { scale: 1 }, { scale: 1.06, duration: 0.15, yoyo: true, repeat: 1, ease: "power1.out" });
        }
        if (halo) {
          gsap.killTweensOf(halo);
          if (live && !reduced) {
            gsap.fromTo(
              halo,
              { attr: { r: 30 }, opacity: 0.5 },
              { attr: { r: 35 }, opacity: 0, duration: 1.6, repeat: -1, ease: "sine.out" },
            );
          } else {
            gsap.set(halo, { opacity: 0 });
          }
        }
      },
      { scope: root, dependencies: [live, reduced] },
    );

    const label = RECORD_LABELS[mode];
    return (
      <div ref={root} className="flex flex-col items-center gap-2">
        <button
          ref={ref}
          type="button"
          onClick={onPress}
          disabled={disabled}
          data-testid="record-control"
          data-mode={mode}
          className={`group relative inline-flex size-[72px] items-center justify-center rounded-full border-2 transition-shadow disabled:cursor-not-allowed disabled:opacity-60 ${
            live ? "border-record shadow-glow-record" : "border-primary-soft hover:shadow-glow-primary"
          }`}
        >
          <svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true" focusable="false">
            <circle data-halo cx="36" cy="36" r="30" fill="none" className="stroke-record" strokeWidth="2" opacity="0" />
            <path data-shape d={CIRCLE} className={live || mode === "countdown" ? "fill-record" : "fill-primary"} />
          </svg>
          <span className="sr-only">{label}</span>
        </button>
        <span aria-hidden="true" className="text-small font-semibold text-text">
          {label}
        </span>
      </div>
    );
  },
);
