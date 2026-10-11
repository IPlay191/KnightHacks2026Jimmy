import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BACKGROUND_IDS,
  BACKGROUNDS,
  coverRect,
  isBackgroundId,
  MASK_EDGE,
  maskToAlpha,
  smoothstep,
} from "@/lib/studio/backgrounds";

describe("camera background catalog", () => {
  it("offers no background plus office, classroom, stage, and Knight Hacks", () => {
    expect(BACKGROUND_IDS).toEqual(["none", "office", "classroom", "stage", "knighthacks"]);
    expect(BACKGROUNDS.none.src).toBeNull();
  });

  it("every scene file exists; SVG scenes are 1280x720 with no scripts or external references", () => {
    for (const id of BACKGROUND_IDS) {
      const src = BACKGROUNDS[id].src;
      if (!src) continue;
      const file = path.resolve("public", src.replace(/^\//, ""));
      expect(existsSync(file), `missing background image: ${file}`).toBe(true);
      if (!file.endsWith(".svg")) continue;
      const svg = readFileSync(file, "utf8");
      expect(svg).toMatch(/<svg[^>]+width="1280"[^>]+height="720"/);
      expect(svg).not.toMatch(/<script|href="http|xlink:href="http|<image/i);
    }
  });

  it("validates stored preference values", () => {
    expect(isBackgroundId("stage")).toBe(true);
    expect(isBackgroundId("beach")).toBe(false);
    expect(isBackgroundId(null)).toBe(false);
  });
});

describe("coverRect", () => {
  it("fills a 4:3 camera frame from a 16:9 scene by cropping the sides", () => {
    const r = coverRect(1280, 720, 640, 480);
    expect(r.h).toBeCloseTo(480);
    expect(r.w).toBeCloseTo(853.33, 1);
    expect(r.x).toBeCloseTo(-106.67, 1);
    expect(r.y).toBeCloseTo(0);
  });

  it("always covers the target and stays centered (property)", () => {
    const dim = fc.integer({ min: 1, max: 4000 });
    fc.assert(
      fc.property(dim, dim, dim, dim, (sw, sh, dw, dh) => {
        const r = coverRect(sw, sh, dw, dh);
        const eps = 1e-6;
        expect(r.x).toBeLessThanOrEqual(eps);
        expect(r.y).toBeLessThanOrEqual(eps);
        expect(r.x + r.w).toBeGreaterThanOrEqual(dw - eps);
        expect(r.y + r.h).toBeGreaterThanOrEqual(dh - eps);
        expect(r.x + r.w / 2).toBeCloseTo(dw / 2, 6);
        expect(r.y + r.h / 2).toBeCloseTo(dh / 2, 6);
        expect(r.w / r.h).toBeCloseTo(sw / sh, 6);
      }),
    );
  });
});

describe("maskToAlpha", () => {
  it("maps confident background to transparent and confident person to opaque", () => {
    const conf = new Float32Array([0, MASK_EDGE.lo, 0.5, MASK_EDGE.hi, 1]);
    const out = new Uint8ClampedArray(conf.length * 4);
    maskToAlpha(conf, null, out);
    const alpha = [3, 7, 11, 15, 19].map((i) => out[i]);
    expect(alpha).toEqual([0, 0, 128, 255, 255]);
    expect(out[0] + out[1] + out[2]).toBe(0);
  });

  it("treats NaN confidence as background", () => {
    const out = new Uint8ClampedArray(4);
    maskToAlpha(new Float32Array([Number.NaN]), null, out);
    expect(out[3]).toBe(0);
  });

  it("temporal smoothing moves toward the new mask without overshooting (property)", () => {
    const unit = fc.float({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(fc.array(fc.tuple(unit, unit), { minLength: 1, maxLength: 64 }), (pairs) => {
        const prev = Float32Array.from(pairs.map(([p]) => p));
        const before = Float32Array.from(prev);
        const conf = Float32Array.from(pairs.map(([, c]) => c));
        const out = new Uint8ClampedArray(conf.length * 4);
        maskToAlpha(conf, prev, out);
        for (let i = 0; i < conf.length; i++) {
          const lo = Math.min(before[i], conf[i]) - 1e-6;
          const hi = Math.max(before[i], conf[i]) + 1e-6;
          expect(prev[i]).toBeGreaterThanOrEqual(lo);
          expect(prev[i]).toBeLessThanOrEqual(hi);
          expect(out[i * 4 + 3]).toBe(Math.round(smoothstep(MASK_EDGE.lo, MASK_EDGE.hi, prev[i]) * 255));
        }
      }),
    );
  });
});
