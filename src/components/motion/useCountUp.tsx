"use client";

import { useRef } from "react";
import { gsap, registerGsap, ScrollTrigger, useGSAP } from "./gsap";
import { useMotion } from "./MotionProvider";
import { dur, ease } from "./tokens";

/**
 * Animated number that counts up when first scrolled into view (R15.6).
 * The animated digits are aria-hidden; screen readers get the final value
 * from the first render, never intermediate numbers.
 */
export function CountUp({
  value,
  decimals = 0,
  duration = dur.chart * 0.75,
  className = "",
  suffix = "",
}: {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { reduced } = useMotion();
  const final = `${value.toFixed(decimals)}${suffix}`;
  useGSAP(
    () => {
      registerGsap();
      const el = ref.current;
      if (!el) return;
      if (reduced) {
        el.textContent = final;
        return;
      }
      const proxy = { v: 0 };
      el.textContent = `${(0).toFixed(decimals)}${suffix}`;
      const tween = gsap.to(proxy, {
        v: value,
        duration,
        ease: ease.emphasized,
        paused: true,
        onUpdate: () => {
          el.textContent = `${proxy.v.toFixed(decimals)}${suffix}`;
        },
      });
      const st = ScrollTrigger.create({ trigger: el, start: "top 90%", once: true, onEnter: () => tween.play() });
      return () => {
        st.kill();
        tween.kill();
      };
    },
    { dependencies: [value, reduced, decimals, suffix] },
  );
  return (
    <span className={className}>
      <span ref={ref} aria-hidden="true" className="tabular">
        {final}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
