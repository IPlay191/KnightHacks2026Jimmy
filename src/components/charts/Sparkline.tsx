import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";

/** Tiny decorative trend line; the row text carries the value (aria-hidden). */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 64;
  const h = 20;
  const x = scaleLinear().domain([0, values.length - 1]).range([2, w - 2]);
  const y = scaleLinear().domain([0, 100]).range([h - 2, 2]);
  const d = line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v))(values);
  return (
    <svg width={w} height={h} aria-hidden="true" focusable="false" className="shrink-0">
      <path d={d ?? ""} fill="none" className="stroke-primary-soft" strokeWidth={1.75} />
    </svg>
  );
}
