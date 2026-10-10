"use client";

import { useEffect } from "react";
import type { MotionPreference } from "@/lib/types";
import { useMotion } from "./MotionProvider";

/** Applies the signed-in guest's saved motion preference (R13.2). */
export function MotionPreferenceSync({ preference }: { preference: MotionPreference }) {
  const { setPreference } = useMotion();
  useEffect(() => {
    setPreference(preference);
  }, [preference, setPreference]);
  return null;
}
