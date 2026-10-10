"use client";

import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

let registered = false;

/** Registers GSAP plugins once (design §13). Safe to call repeatedly. */
export function registerGsap(): typeof gsap {
  if (!registered && typeof window !== "undefined") {
    gsap.registerPlugin(useGSAP, ScrollTrigger, DrawSVGPlugin, MorphSVGPlugin, SplitText);
    registered = true;
  }
  return gsap;
}

export { gsap, useGSAP, ScrollTrigger, SplitText };
