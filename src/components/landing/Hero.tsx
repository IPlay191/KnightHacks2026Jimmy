"use client";

import { useActionState, useRef } from "react";
import { ArrowRight, BarChart3 } from "lucide-react";
import { continueAsGuest, type GuestActionState } from "@/app/actions/guest";
import { gsap, registerGsap, SplitText, useGSAP } from "@/components/motion/gsap";
import { useMotion } from "@/components/motion/MotionProvider";
import { dur, ease } from "@/components/motion/tokens";
import { buttonClasses } from "@/components/ui/Button";
import { AuroraBackground } from "./AuroraBackground";

/** Landing hero with the two primary actions (R1.1, R1.2, R1.4). */
export function Hero({ showSample }: { showSample: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { reduced } = useMotion();
  const [state, action, pending] = useActionState<GuestActionState, FormData>(continueAsGuest, { error: null });

  useGSAP(
    () => {
      registerGsap();
      const headline = ref.current?.querySelector("[data-headline]");
      const fades = ref.current?.querySelectorAll("[data-fade]");
      if (!headline || reduced) return;
      const split = SplitText.create(headline, { type: "words", aria: "auto" });
      gsap.from(split.words, { y: 16, opacity: 0, duration: dur.slow, ease: ease.emphasized, stagger: 0.04 });
      if (fades?.length) gsap.from(fades, { y: 12, opacity: 0, duration: dur.base, ease: ease.enter, stagger: 0.08, delay: 0.3 });
      return () => split.revert();
    },
    { scope: ref, dependencies: [reduced] },
  );

  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <AuroraBackground />
      <div ref={ref} className="relative z-10 mx-auto flex max-w-[1200px] flex-col items-start gap-6 px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
        <p data-fade className="rounded-full border border-border-strong bg-canvas/60 px-3 py-1 text-small text-text-secondary">
          Open-source AI speech coach
        </p>
        <h1 id="hero-title" data-headline className="max-w-3xl text-display-xl text-text">
          Practice out loud. Get coaching that actually helps.
        </h1>
        <p data-fade className="max-w-[60ch] text-body-l text-text-secondary">
          Record a practice speech with your camera and mic. In under a minute you&apos;ll see your pace, pauses, filler
          words, clarity, and how well you fit your audience, with three specific things to work on next.
        </p>
        <form action={action} data-fade className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            name="next"
            value="studio"
            disabled={pending}
            className={buttonClasses("primary", "lg")}
            data-testid="start-practicing"
          >
            {pending ? "Setting up…" : "Start practicing"}
            <ArrowRight aria-hidden="true" size={20} />
          </button>
          {showSample ? (
            <button
              type="submit"
              name="next"
              value="sample"
              disabled={pending}
              className={buttonClasses("secondary", "lg")}
              data-testid="see-sample"
            >
              <BarChart3 aria-hidden="true" size={20} />
              See a sample report
            </button>
          ) : null}
        </form>
        {state.error ? (
          <p role="alert" className="text-danger">
            {state.error}
          </p>
        ) : null}
        <p data-fade className="text-small text-text-muted">No sign-up. Your guest profile stays on this browser.</p>
      </div>
    </section>
  );
}
