"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MotionPreference } from "@/lib/types";

interface MotionContextValue {
  /** True when animations must be skipped or reduced to short fades (R15.7). */
  reduced: boolean;
  preference: MotionPreference;
  setPreference: (p: MotionPreference) => void;
}

const MotionContext = createContext<MotionContextValue>({
  reduced: false,
  preference: "system",
  setPreference: () => undefined,
});

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Resolves the effective motion mode from the user setting and the media
 * query, and mirrors it on <html data-motion> so CSS follows the same rule.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  // The signed-in guest's saved preference is applied by MotionPreferenceSync.
  const [preference, setPreference] = useState<MotionPreference>("system");
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const update = () => setSystemReduced(mq.matches);
    // Initial read happens in a microtask so the effect body itself doesn't set state.
    queueMicrotask(update);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const reduced = preference === "reduce" || (preference === "system" && systemReduced);

  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduce" : "full";
  }, [reduced]);

  const value = useMemo(() => ({ reduced, preference, setPreference }), [reduced, preference]);
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion(): MotionContextValue {
  return useContext(MotionContext);
}
