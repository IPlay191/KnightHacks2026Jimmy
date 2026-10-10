"use client";

import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { useId, useMemo, useRef } from "react";
import { gsap, registerGsap, ScrollTrigger, useGSAP } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";
import { ease } from "@/components/motion/tokens";
import { formatClock, formatSeconds } from "@/lib/format";
import type { Interval, TimelineWindow } from "@/lib/types";
import { ChartFigure } from "./ChartFigure";
import { useElementWidth } from "./useElementWidth";

const HEIGHT = 240;
const M = { top: 16, right: 16, bottom: 40, left: 44 };

/**
 * WPM per 15-second window with the target band, long-pause markers, and a
 * filler rug (R10.3). Series are distinguished by shape, not color alone.
 */
export function PaceTimeline({
  windows,
  durationMs,
  targetMin,
  targetMax,
  longPauses,
  fillerTimesMs,
}: {
  windows: TimelineWindow[];
  durationMs: number;
  targetMin: number;
  targetMax: number;
  longPauses: Interval[];
  fillerTimesMs: number[];
}) {
  const { ref: boxRef, width } = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useId();
  const hatchId = useId();
  const { reduced } = useMotion();
  const innerW = Math.max(160, width - M.left - M.right);
  const innerH = HEIGHT - M.top - M.bottom;

  const { x, y, areaD, lineD, points, ticks } = useMemo(() => {
    const maxWpm = Math.max(200, targetMax + 30, ...windows.map((w) => w.wpm + 20));
    const xs = scaleLinear().domain([0, Math.max(1, durationMs)]).range([0, innerW]);
    const ys = scaleLinear().domain([0, maxWpm]).range([innerH, 0]).nice();
    const pts = windows.map((w) => ({ x: xs((w.startMs + w.endMs) / 2), y: ys(w.wpm), w }));
    const areaGen = area<{ x: number; y: number }>()
      .x((p) => p.x)
      .y0(innerH)
      .y1((p) => p.y)
      .curve(curveMonotoneX);
    const lineGen = line<{ x: number; y: number }>()
      .x((p) => p.x)
      .y((p) => p.y)
      .curve(curveMonotoneX);
    const tickCount = width < 480 ? 4 : 8;
    const tickStep = Math.max(15_000, Math.ceil(durationMs / tickCount / 15_000) * 15_000);
    const t: number[] = [];
    for (let v = 0; v <= durationMs; v += tickStep) t.push(v);
    return { x: xs, y: ys, areaD: areaGen(pts) ?? "", lineD: lineGen(pts) ?? "", points: pts, ticks: t };
  }, [windows, durationMs, innerW, innerH, targetMax, width]);

  useGSAP(
    () => {
      registerGsap();
      const svg = svgRef.current;
      if (!svg) return;
      const lineEl = svg.querySelector("[data-line]");
      const clipRect = svg.querySelector("[data-clip]");
      const markers = svg.querySelectorAll("[data-marker]");
      if (reduced) {
        if (lineEl) gsap.set(lineEl, { drawSVG: "100%" });
        if (clipRect) gsap.set(clipRect, { scaleX: 1 });
        gsap.set(markers, { scale: 1, opacity: 1 });
        return;
      }
      const tl = gsap.timeline({ paused: true });
      if (lineEl) tl.fromTo(lineEl, { drawSVG: "0%" }, { drawSVG: "100%", duration: 1, ease: ease.emphasized }, 0);
      if (clipRect) tl.fromTo(clipRect, { scaleX: 0 }, { scaleX: 1, duration: 1, ease: ease.emphasized, transformOrigin: "left center" }, 0);
      if (markers.length) {
        tl.fromTo(
          markers,
          { scale: 0, opacity: 0, transformOrigin: "center" },
          { scale: 1, opacity: 1, duration: 0.3, stagger: 0.03, ease: ease.springy },
          0.6,
        );
      }
      const st = ScrollTrigger.create({ trigger: svg, start: "top 85%", once: true, onEnter: () => tl.play() });
      return () => {
        st.kill();
        tl.kill();
      };
    },
    { dependencies: [reduced, lineD], scope: boxRef },
  );

  const avg = windows.length ? Math.round(windows.reduce((a, w) => a + w.wpm, 0) / windows.length) : 0;
  const above = windows.filter((w) => w.wpm > targetMax).length;
  const below = windows.filter((w) => w.wpm < targetMin).length;
  const peak = windows.reduce<TimelineWindow | null>((p, w) => (!p || w.wpm > p.wpm ? w : p), null);
  const summary = windows.length
    ? `Average ${avg} words per minute across ${windows.length} windows. ${above} above and ${below} below the ${targetMin}–${targetMax} target.${
        peak ? ` Peak ${Math.round(peak.wpm)} at ${formatClock(peak.startMs)}.` : ""
      } ${longPauses.length} long pauses and ${fillerTimesMs.length} filler words are marked.`
    : "Not enough speech to chart pace.";

  return (
    <ChartFigure
      title="Pace over time"
      summary={summary}
      table={{
        caption: "Words per minute for each 15-second window",
        columns: ["Window", "Words per minute", "Versus target"],
        rows: windows.map((w) => [
          `${formatClock(w.startMs)}–${formatClock(w.endMs)}`,
          Math.round(w.wpm),
          w.wpm > targetMax ? "Above" : w.wpm < targetMin ? "Below" : "In range",
        ]),
      }}
    >
      {() => (
        <div ref={boxRef} className="w-full">
          <svg ref={svgRef} width={width} height={HEIGHT} role="presentation" aria-hidden="true" className="block">
            <defs>
              <clipPath id={clipId}>
                <rect data-clip x={0} y={0} width={innerW} height={innerH} />
              </clipPath>
              <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" className="stroke-text-muted" strokeWidth="2" />
              </pattern>
            </defs>
            <g transform={`translate(${M.left},${M.top})`}>
              {/* target band with a direct label */}
              <rect
                x={0}
                width={innerW}
                y={y(targetMax)}
                height={Math.max(0, y(targetMin) - y(targetMax))}
                className="fill-success"
                opacity={0.12}
              />
              <line x1={0} x2={innerW} y1={y(targetMax)} y2={y(targetMax)} className="stroke-success" strokeDasharray="4 4" />
              <line x1={0} x2={innerW} y1={y(targetMin)} y2={y(targetMin)} className="stroke-success" strokeDasharray="4 4" />
              <text x={innerW - 4} y={y(targetMax) - 6} textAnchor="end" className="fill-success text-[12px] font-semibold">
                Target {targetMin}–{targetMax}
              </text>
              {/* y axis */}
              {y.ticks(4).map((t) => (
                <g key={t} transform={`translate(0,${y(t)})`}>
                  <line x1={0} x2={innerW} className="stroke-border-subtle" />
                  <text x={-8} dy="0.32em" textAnchor="end" className="fill-text-muted text-[12px] tabular">
                    {t}
                  </text>
                </g>
              ))}
              <text x={-34} y={-4} className="fill-text-muted text-[12px]">
                WPM
              </text>
              {/* long pauses: hatched bars */}
              {longPauses.map((p, i) => (
                <rect
                  key={`p${i}`}
                  data-marker
                  x={x(p.startMs)}
                  width={Math.max(3, x(p.endMs) - x(p.startMs))}
                  y={0}
                  height={innerH}
                  fill={`url(#${hatchId})`}
                  opacity={0.6}
                />
              ))}
              {/* pace area + line */}
              <path d={areaD} className="fill-primary" opacity={0.18} clipPath={`url(#${clipId})`} />
              <path data-line d={lineD} fill="none" className="stroke-primary-soft" strokeWidth={3} strokeLinejoin="round" />
              {points.map((p, i) => (
                <circle key={i} data-marker cx={p.x} cy={p.y} r={4} className="fill-primary-soft stroke-canvas" strokeWidth={2} />
              ))}
              {/* filler rug: triangles along the bottom */}
              {fillerTimesMs.map((t, i) => (
                <path
                  key={`f${i}`}
                  data-marker
                  d={`M ${x(t)} ${innerH - 10} l 5 9 l -10 0 z`}
                  className="fill-warning"
                />
              ))}
              {/* x axis */}
              <line x1={0} x2={innerW} y1={innerH} y2={innerH} className="stroke-border-strong" />
              {ticks.map((t) => (
                <text key={t} x={x(t)} y={innerH + 18} textAnchor="middle" className="fill-text-muted text-[12px] tabular">
                  {formatClock(t)}
                </text>
              ))}
            </g>
          </svg>
          <ul className="mt-2 flex flex-wrap gap-4 text-caption text-text-secondary" aria-label="Chart legend">
            <li className="flex items-center gap-2">
              <svg width="18" height="10" aria-hidden="true">
                <line x1="0" y1="5" x2="18" y2="5" className="stroke-primary-soft" strokeWidth="3" />
                <circle cx="9" cy="5" r="3" className="fill-primary-soft" />
              </svg>
              Words per minute
            </li>
            <li className="flex items-center gap-2">
              <svg width="14" height="12" aria-hidden="true">
                <rect width="14" height="12" fill={`url(#${hatchId})`} />
              </svg>
              Long pause (2 s or more{longPauses[0] ? `, longest ${formatSeconds(Math.max(...longPauses.map((p) => p.endMs - p.startMs)))}` : ""})
            </li>
            <li className="flex items-center gap-2">
              <svg width="12" height="10" aria-hidden="true">
                <path d="M 6 0 l 6 10 l -12 0 z" className="fill-warning" />
              </svg>
              Filler word
            </li>
          </ul>
        </div>
      )}
    </ChartFigure>
  );
}
