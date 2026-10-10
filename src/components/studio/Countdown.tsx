"use client";

import { useRef } from "react";
import { gsap, registerGsap, useGSAP } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";
import { dur } from "@/components/motion/tokens";

/** 3-2-1 overlay (R4.2). Numeral scale/fade and a depleting ring (R15.3). */
export function Countdown({ remaining }: { remaining: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();
  useGSAP(
    () => {
      registerGsap();
      const num = ref.current?.querySelector("[data-num]");
      const ring = ref.current?.querySelector("[data-ring]");
      if (!num) return;
      if (reduced) {
        gsap.fromTo(num, { opacity: 0 }, { opacity: 1, duration: dur.reducedFade });
        return;
      }
      gsap.fromTo(num, { scale: 1.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.6)" });
      if (ring) gsap.fromTo(ring, { drawSVG: `${(remaining / 3) * 100}%` }, { drawSVG: `${((remaining - 1) / 3) * 100}%`, duration: 1, ease: "none" });
    },
    { scope: ref, dependencies: [remaining, reduced] },
  );
  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-canvas/70 backdrop-blur-sm"
      data-testid="countdown"
    >
      <div className="relative flex size-40 items-center justify-center">
        {!reduced ? (
          <svg viewBox="0 0 160 160" className="absolute inset-0 -rotate-90" aria-hidden="true">
            <circle cx="80" cy="80" r="70" fill="none" className="stroke-border-subtle" strokeWidth="6" />
            <circle data-ring cx="80" cy="80" r="70" fill="none" className="stroke-record" strokeWidth="6" strokeLinecap="round" />
          </svg>
        ) : null}
        <span data-num aria-hidden="true" className="font-mono text-7xl font-medium text-text tabular">
          {remaining}
        </span>
      </div>
      <p className="sr-only">Recording starts in {remaining}</p>
    </div>
  );
}
