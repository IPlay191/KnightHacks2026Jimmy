"use client";

import { useId, useRef } from "react";
import { gsap, registerGsap, ScrollTrigger, useGSAP } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";
import { CountUp } from "@/components/motion/useCountUp";
import { dur, ease } from "@/components/motion/tokens";
import { scoreLabel } from "@/lib/scoring";

const SIZE = 220;
const STROKE = 16;
const R = (SIZE - STROKE) / 2;
const SWEEP = 270;

function arcPath(): string {
  const c = SIZE / 2;
  const start = (135 * Math.PI) / 180;
  const end = ((135 + SWEEP) * Math.PI) / 180;
  const x1 = c + R * Math.cos(start);
  const y1 = c + R * Math.sin(start);
  const x2 = c + R * Math.cos(end);
  const y2 = c + R * Math.sin(end);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 1 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Overall score ring with qualitative label (R10.1). GSAP draws the arc (R15.6). */
export function ScoreRing({ score }: { score: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const gradId = useId();
  const { reduced } = useMotion();
  const pct = Math.max(0, Math.min(100, score));
  const d = arcPath();
  useGSAP(
    () => {
      registerGsap();
      const arc = ref.current?.querySelector("[data-arc]");
      if (!arc) return;
      if (reduced || pct === 0) {
        gsap.set(arc, { drawSVG: `0% ${pct}%` });
        return;
      }
      gsap.set(arc, { drawSVG: "0% 0%" });
      const tween = gsap.to(arc, { drawSVG: `0% ${pct}%`, duration: dur.chart, ease: ease.emphasized, paused: true });
      const st = ScrollTrigger.create({ trigger: ref.current, start: "top 90%", once: true, onEnter: () => tween.play() });
      return () => {
        st.kill();
        tween.kill();
      };
    },
    { dependencies: [pct, reduced] },
  );
  const label = scoreLabel(score);
  return (
    <div className="relative inline-flex size-[220px] shrink-0 items-center justify-center">
      <svg ref={ref} viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: "var(--sr-primary)" }} />
            <stop offset="100%" style={{ stopColor: "var(--sr-success)" }} />
          </linearGradient>
        </defs>
        <path d={d} fill="none" className="stroke-border-subtle" strokeWidth={STROKE} strokeLinecap="round" />
        <path data-arc d={d} fill="none" stroke={`url(#${gradId})`} strokeWidth={STROKE} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="sr-only">Overall score {score} out of 100, {label}.</span>
        <span aria-hidden="true" className="text-display-l text-text">
          <CountUp value={score} />
        </span>
        <span aria-hidden="true" className="text-small text-text-muted">
          out of 100
        </span>
        <span aria-hidden="true" className="mt-1 rounded-full bg-surface-raised px-3 py-0.5 text-small font-semibold text-text">
          {label}
        </span>
      </div>
    </div>
  );
}
