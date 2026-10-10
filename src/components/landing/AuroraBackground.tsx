"use client";

import { useRef } from "react";
import { gsap, registerGsap, useGSAP } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";

const BLOBS = [
  { cls: "bg-primary/30", style: { width: "38rem", height: "38rem", left: "-8rem", top: "-12rem" } },
  { cls: "bg-success/20", style: { width: "30rem", height: "30rem", right: "-6rem", top: "-4rem" } },
  { cls: "bg-record/15", style: { width: "26rem", height: "26rem", left: "35%", top: "10rem" } },
];

/**
 * Decorative aurora (design §12.1). Slow drift paused when off-screen or the
 * tab is hidden; static under reduced motion (R15.7).
 */
export function AuroraBackground() {
  const ref = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();
  useGSAP(
    () => {
      registerGsap();
      if (reduced || !ref.current) return;
      const blobs = ref.current.querySelectorAll("[data-blob]");
      const tweens = Array.from(blobs).map((b, i) =>
        gsap.to(b, {
          x: i % 2 ? -40 : 40,
          y: i % 2 ? 30 : -30,
          scale: i % 2 ? 0.95 : 1.05,
          duration: 18 + i * 3,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
        }),
      );
      const io = new IntersectionObserver(([entry]) => {
        tweens.forEach((t) => (entry?.isIntersecting && !document.hidden ? t.resume() : t.pause()));
      });
      io.observe(ref.current);
      const onVis = () => tweens.forEach((t) => (document.hidden ? t.pause() : t.resume()));
      document.addEventListener("visibilitychange", onVis);
      return () => {
        io.disconnect();
        document.removeEventListener("visibilitychange", onVis);
      };
    },
    { scope: ref, dependencies: [reduced] },
  );
  return (
    <div ref={ref} className="sr-aurora" aria-hidden="true">
      {BLOBS.map((b, i) => (
        <div key={i} data-blob className={`sr-aurora__blob ${b.cls}`} style={b.style} />
      ))}
      <div className="sr-aurora__scrim" />
    </div>
  );
}
