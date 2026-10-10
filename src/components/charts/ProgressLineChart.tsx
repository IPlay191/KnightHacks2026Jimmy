"use client";

import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { ToggleGroup } from "radix-ui";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { gsap, registerGsap, ScrollTrigger, useGSAP } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";
import { ease } from "@/components/motion/tokens";
import { audienceLabel } from "@/lib/audience";
import { formatDate } from "@/lib/format";
import type { Audience } from "@/lib/types";
import { ChartFigure } from "./ChartFigure";
import { useElementWidth } from "./useElementWidth";

export interface ProgressDatum {
  id: string;
  completedAt: string;
  title: string | null;
  audience: Audience;
  overall: number;
  pacing: number;
  fillers: number;
  pauses: number;
  clarity: number | null;
}

type SeriesKey = "overall" | "pacing" | "fillers" | "pauses" | "clarity";

/** Each series has its own color, marker shape, and dash pattern (R15.8). */
const SERIES: Record<SeriesKey, { label: string; color: string; fill: string; dash?: string; marker: "circle" | "square" | "triangle" | "diamond" | "cross" }> = {
  overall: { label: "Overall", color: "stroke-data-1", fill: "fill-data-1", marker: "circle" },
  pacing: { label: "Pacing", color: "stroke-data-2", fill: "fill-data-2", dash: "6 3", marker: "square" },
  fillers: { label: "Filler words", color: "stroke-data-3", fill: "fill-data-3", dash: "2 3", marker: "triangle" },
  pauses: { label: "Pauses", color: "stroke-data-4", fill: "fill-data-4", dash: "8 3 2 3", marker: "diamond" },
  clarity: { label: "Clarity", color: "stroke-data-5", fill: "fill-data-5", dash: "1 2", marker: "cross" },
};
const TOGGLEABLE: SeriesKey[] = ["pacing", "fillers", "pauses", "clarity"];
const HEIGHT = 260;
const M = { top: 16, right: 96, bottom: 36, left: 40 };

function Marker({ kind, x, y, className }: { kind: (typeof SERIES)[SeriesKey]["marker"]; x: number; y: number; className: string }) {
  const s = 5;
  switch (kind) {
    case "square":
      return <rect data-pt x={x - s} y={y - s} width={s * 2} height={s * 2} className={className} />;
    case "triangle":
      return <path data-pt d={`M ${x} ${y - s - 1} L ${x + s + 1} ${y + s} L ${x - s - 1} ${y + s} Z`} className={className} />;
    case "diamond":
      return <path data-pt d={`M ${x} ${y - s - 1} L ${x + s + 1} ${y} L ${x} ${y + s + 1} L ${x - s - 1} ${y} Z`} className={className} />;
    case "cross":
      return (
        <path
          data-pt
          d={`M ${x - s} ${y - s} L ${x + s} ${y + s} M ${x + s} ${y - s} L ${x - s} ${y + s}`}
          className={className.replace("fill-", "stroke-")}
          strokeWidth={2.5}
          fill="none"
        />
      );
    default:
      return <circle data-pt cx={x} cy={y} r={s} className={className} />;
  }
}

/** Scores across sessions, oldest → newest, with series toggles (R12.1). */
export function ProgressLineChart({ data }: { data: ProgressDatum[] }) {
  const [enabled, setEnabled] = useState<SeriesKey[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const { ref: boxRef, width } = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const { reduced } = useMotion();
  const points = showAll ? data : data.slice(-20);
  const series: SeriesKey[] = ["overall", ...enabled];
  const innerW = Math.max(160, width - M.left - M.right);
  const innerH = HEIGHT - M.top - M.bottom;

  const { x, y, paths } = useMemo(() => {
    const xs = scaleLinear().domain([0, Math.max(1, points.length - 1)]).range([0, innerW]);
    const ys = scaleLinear().domain([0, 100]).range([innerH, 0]);
    const out = {} as Record<SeriesKey, string>;
    for (const key of Object.keys(SERIES) as SeriesKey[]) {
      out[key] =
        line<ProgressDatum>()
          .defined((d) => d[key] !== null)
          .x((_, i) => xs(i))
          .y((d) => ys((d[key] as number) ?? 0))(points) ?? "";
    }
    return { x: xs, y: ys, paths: out };
  }, [points, innerW, innerH]);

  useGSAP(
    () => {
      registerGsap();
      const svg = svgRef.current;
      if (!svg) return;
      const lines = svg.querySelectorAll("[data-series]");
      const pts = svg.querySelectorAll("[data-pt]");
      if (reduced) {
        gsap.set(lines, { drawSVG: "100%" });
        gsap.set(pts, { opacity: 1, scale: 1 });
        return;
      }
      const tl = gsap.timeline({ paused: true });
      tl.fromTo(lines, { drawSVG: "0%" }, { drawSVG: "100%", duration: 1, ease: ease.emphasized, stagger: 0.08 }, 0);
      tl.fromTo(pts, { opacity: 0, scale: 0, transformOrigin: "center" }, { opacity: 1, scale: 1, duration: 0.25, stagger: 0.01, ease: ease.springy }, 0.4);
      const st = ScrollTrigger.create({ trigger: svg, start: "top 90%", once: true, onEnter: () => tl.play() });
      return () => {
        st.kill();
        tl.kill();
      };
    },
    { dependencies: [reduced, series.join(","), points.length], scope: boxRef },
  );

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((a) => {
        const cur = a ?? (e.key === "ArrowRight" ? -1 : points.length);
        return Math.max(0, Math.min(points.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1)));
      });
    } else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(points.length - 1);
    else if (e.key === "Escape") setActive(null);
  };

  const first = points[0];
  const last = points[points.length - 1];
  const summary =
    points.length >= 2 && first && last
      ? `Overall score went from ${first.overall} to ${last.overall} across ${points.length} sessions. Best ${Math.max(
          ...points.map((p) => p.overall),
        )}.`
      : points.length === 1 && first
        ? `One session so far, with an overall score of ${first.overall}.`
        : "No completed sessions yet.";
  const activePoint = active !== null ? points[active] : null;

  return (
    <ChartFigure
      title="Progress over time"
      headingLevel={2}
      summary={summary}
      table={{
        caption: "Scores per session, oldest first",
        columns: ["Session", "Overall", "Pacing", "Filler words", "Pauses", "Clarity"],
        rows: points.map((p) => [
          `${formatDate(p.completedAt)} · ${p.title ?? "Untitled"}`,
          p.overall,
          p.pacing,
          p.fillers,
          p.pauses,
          p.clarity ?? "Not available",
        ]),
      }}
      actions={
        <ToggleGroup.Root
          type="multiple"
          value={enabled}
          onValueChange={(v) => setEnabled(v as SeriesKey[])}
          aria-label="Show more series"
          className="flex flex-wrap gap-1"
        >
          {TOGGLEABLE.map((k) => (
            <ToggleGroup.Item
              key={k}
              value={k}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-small text-text-secondary data-[state=on]:border-primary-soft data-[state=on]:bg-surface-raised data-[state=on]:text-text"
            >
              <svg width="14" height="14" aria-hidden="true">
                <Marker kind={SERIES[k].marker} x={7} y={7} className={SERIES[k].fill} />
              </svg>
              {SERIES[k].label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      }
    >
      {() => (
        <div ref={boxRef} className="w-full">
          <div
            tabIndex={0}
            role="group"
            aria-label="Progress chart. Use the left and right arrow keys to move between sessions."
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="relative rounded-md"
          >
            <svg ref={svgRef} width={width} height={HEIGHT} aria-hidden="true" className="block">
              <g transform={`translate(${M.left},${M.top})`}>
                {[0, 25, 50, 75, 100].map((t) => (
                  <g key={t} transform={`translate(0,${y(t)})`}>
                    <line x1={0} x2={innerW} className="stroke-border-subtle" />
                    <text x={-8} dy="0.32em" textAnchor="end" className="fill-text-muted text-[12px] tabular">
                      {t}
                    </text>
                  </g>
                ))}
                {series.map((k) => (
                  <g key={k}>
                    <path
                      data-series
                      d={paths[k]}
                      fill="none"
                      className={SERIES[k].color}
                      strokeWidth={k === "overall" ? 3 : 2}
                      strokeDasharray={SERIES[k].dash}
                    />
                    {points.map((p, i) =>
                      p[k] === null ? null : (
                        <Marker key={p.id} kind={SERIES[k].marker} x={x(i)} y={y(p[k] as number)} className={SERIES[k].fill} />
                      ),
                    )}
                    {last && last[k] !== null ? (
                      <text x={innerW + 10} y={y(last[k] as number)} dy="0.32em" className={`${SERIES[k].fill} text-[12px] font-semibold`}>
                        {SERIES[k].label} {last[k]}
                      </text>
                    ) : null}
                  </g>
                ))}
                {activePoint && active !== null ? (
                  <line x1={x(active)} x2={x(active)} y1={0} y2={innerH} className="stroke-focus" strokeWidth={2} />
                ) : null}
                <line x1={0} x2={innerW} y1={innerH} y2={innerH} className="stroke-border-strong" />
                {first ? (
                  <text x={0} y={innerH + 20} className="fill-text-muted text-[12px]">
                    {formatDate(first.completedAt)}
                  </text>
                ) : null}
                {last && points.length > 1 ? (
                  <text x={innerW} y={innerH + 20} textAnchor="end" className="fill-text-muted text-[12px]">
                    {formatDate(last.completedAt)}
                  </text>
                ) : null}
              </g>
            </svg>
            {activePoint ? (
              <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-border-strong bg-surface-raised px-3 py-2 text-small shadow-3">
                <p className="font-semibold text-text">
                  {formatDate(activePoint.completedAt)} · {activePoint.title ?? "Untitled"}
                </p>
                <p className="text-text-secondary">
                  {audienceLabel(activePoint.audience)} audience · Overall {activePoint.overall}
                  {enabled.map((k) => ` · ${SERIES[k].label} ${activePoint[k] ?? "n/a"}`).join("")}
                </p>
              </div>
            ) : null}
            <p className="sr-only" aria-live="polite">
              {activePoint
                ? `Session ${active! + 1} of ${points.length}, ${formatDate(activePoint.completedAt)}, ${
                    activePoint.title ?? "Untitled"
                  }, ${audienceLabel(activePoint.audience)} audience, overall ${activePoint.overall}${enabled
                    .map((k) => `, ${SERIES[k].label} ${activePoint[k] ?? "not available"}`)
                    .join("")}.`
                : ""}
            </p>
          </div>
          {data.length > 20 ? (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="mt-2 min-h-9 rounded-md px-2 text-small text-primary-soft underline"
            >
              {showAll ? "Show the last 20 sessions" : `Show all ${data.length} sessions`}
            </button>
          ) : null}
        </div>
      )}
    </ChartFigure>
  );
}
