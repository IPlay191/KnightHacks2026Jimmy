/** Motion tokens for GSAP (design §12.4). Mirrors the CSS variables in globals.css. */
export const dur = {
  instant: 0.12,
  fast: 0.2,
  base: 0.35,
  slow: 0.6,
  chart: 1.2,
  /** Reduced-motion fades must stay at or below 150 ms (R15.7). */
  reducedFade: 0.15,
} as const;

export const ease = {
  standard: "power2.out",
  emphasized: "expo.out",
  enter: "power3.out",
  exit: "power2.in",
  springy: "back.out(1.6)",
} as const;

export const stagger = {
  list: 0.06,
} as const;
