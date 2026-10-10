"use client";

import { useRef } from "react";
import { gsap, registerGsap, ScrollTrigger, useGSAP } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";
import { ease } from "@/components/motion/tokens";
import type { FillerBreakdown } from "@/lib/types";
import { ChartFigure } from "./ChartFigure";

/** Filler terms sorted by count, with AI-confirmed terms marked (R10.4). */
export function FillerBars({ breakdown, perMin }: { breakdown: FillerBreakdown; perMin: number }) {
  const ref = useRef<HTMLUListElement>(null);
  const { reduced } = useMotion();
  const entries = Object.entries(breakdown)
    .filter(([, v]) => v.count > 0)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  const max = Math.max(1, ...entries.map(([, v]) => v.count));
  const total = entries.reduce((a, [, v]) => a + v.count, 0);

  useGSAP(
    () => {
      registerGsap();
      const bars = ref.current?.querySelectorAll("[data-bar]");
      if (!bars?.length) return;
      if (reduced) {
        gsap.set(bars, { scaleX: 1 });
        return;
      }
      const tween = gsap.fromTo(
        bars,
        { scaleX: 0 },
        { scaleX: 1, duration: 0.8, stagger: 0.05, ease: ease.emphasized, transformOrigin: "left center", paused: true },
      );
      const st = ScrollTrigger.create({ trigger: ref.current, start: "top 90%", once: true, onEnter: () => tween.play() });
      return () => {
        st.kill();
        tween.kill();
      };
    },
    { scope: ref, dependencies: [reduced, entries.length] },
  );

  const summary = entries.length
    ? `${total} filler words, about ${perMin.toFixed(1)} per minute. Most frequent: ${entries
        .slice(0, 3)
        .map(([k, v]) => `"${k}" ${v.count}`)
        .join(", ")}.`
    : "No filler words were counted in this session.";

  return (
    <ChartFigure
      title="Filler words"
      summary={summary}
      table={{
        caption: "Filler words by count",
        columns: ["Word or phrase", "Count", "How it was counted"],
        rows: entries.map(([k, v]) => [k, v.count, v.confirmed ? "Confirmed by AI in context" : "Always a filler"]),
      }}
    >
      {() =>
        entries.length ? (
          <ul ref={ref} className="flex flex-col gap-2" aria-hidden="true">
            {entries.map(([k, v]) => (
              <li key={k} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3">
                <span className="truncate text-small text-text">
                  “{k}”{v.confirmed ? <span className="text-text-muted"> · AI-confirmed</span> : null}
                </span>
                <span className="h-6 rounded-sm bg-canvas/60">
                  <span
                    data-bar
                    className={`block h-full rounded-sm ${v.confirmed ? "border-2 border-dotted border-data-3 bg-data-3/30" : "bg-data-3"}`}
                    style={{ width: `${(v.count / max) * 100}%` }}
                  />
                </span>
                <span className="w-8 text-right text-small font-semibold tabular text-text">{v.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-secondary">Nice work: no filler words were detected.</p>
        )
      }
    </ChartFigure>
  );
}
