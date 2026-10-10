"use client";

import { useEffect, useRef, useState } from "react";
import { MIC_STATUS_TEXT, MicCheck, meterValue, peakDbfs, rmsDbfs, type MicStatus } from "@/lib/audio/level";
import { gsap, registerGsap } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";
import { CheckCircle2, Volume1, Volume2 } from "lucide-react";

const BARS = 24;

/**
 * Live mic level meter driven by GSAP on the shared ticker (R15.4). The meter
 * is decorative (aria-hidden); MicCheckStatus is the text equivalent (R3.4).
 */
export function LevelMeter({
  analyser,
  active,
  showStatus,
}: {
  analyser: AnalyserNode | null;
  active: boolean;
  showStatus: boolean;
}) {
  const barsRef = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();
  const [status, setStatus] = useState<MicStatus>("good");

  useEffect(() => {
    if (!analyser || !active || !barsRef.current) return;
    registerGsap();
    const bars = Array.from(barsRef.current.children) as HTMLElement[];
    const setters = bars.map((bar) =>
      reduced
        ? (v: number) => gsap.set(bar, { scaleY: v })
        : gsap.quickTo(bar, "scaleY", { duration: 0.08, ease: "power2.out" }),
    );
    const buffer = new Float32Array(analyser.fftSize);
    const check = new MicCheck();
    let lastStatus: MicStatus = "good";
    const tick = () => {
      if (document.hidden) return;
      analyser.getFloatTimeDomainData(buffer);
      const rms = rmsDbfs(buffer);
      const level = meterValue(rms);
      const lit = Math.round(level * BARS);
      setters.forEach((set, i) => {
        const shape = 0.35 + 0.65 * Math.sin(((i + 1) / (BARS + 1)) * Math.PI);
        set(i < lit ? Math.max(0.12, level * shape + 0.1) : 0.08);
      });
      const next = check.update(rms, peakDbfs(buffer), performance.now());
      if (next !== lastStatus) {
        lastStatus = next;
        setStatus(next);
      }
    };
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
    };
  }, [analyser, active, reduced]);

  const Icon = status === "good" ? CheckCircle2 : status === "quiet" ? Volume1 : Volume2;
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={barsRef}
        aria-hidden="true"
        className="flex h-12 items-center gap-[3px] rounded-md border border-border-subtle bg-canvas/60 px-3"
      >
        {Array.from({ length: BARS }, (_, i) => (
          <div
            key={i}
            className={`h-full flex-1 origin-center rounded-full ${
              i > BARS * 0.85 ? "bg-record" : i > BARS * 0.65 ? "bg-warning" : "bg-success"
            }`}
            style={{ transform: "scaleY(0.08)" }}
          />
        ))}
      </div>
      {showStatus ? (
        <p className="flex items-center gap-2 text-small text-text-secondary" data-testid="mic-status">
          <Icon aria-hidden="true" size={16} className={status === "good" ? "text-success" : "text-warning"} />
          <span>
            <span className="sr-only">Microphone check: </span>
            {MIC_STATUS_TEXT[status]}
          </span>
        </p>
      ) : null}
    </div>
  );
}
