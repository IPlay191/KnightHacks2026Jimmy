import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planChunks } from "@/lib/audio/chunker";
import { encodeWavPcm16 } from "@/lib/audio/wav";
import { MicCheck } from "@/lib/audio/level";
import { resampleLinear } from "@/lib/audio/resample";
import { parseWav, WavError } from "@/server/audio/wav-parse";
import { signIdentity, verifyIdentity } from "@/server/auth/token";
import { audienceFitScore, fillersScore, overallScore, pacingScore, pausesScore, scoreLabel } from "@/lib/scoring";
import { resolveAudienceProfile } from "@/lib/audience";
import { computeStreak, computeTrend } from "@/lib/progress";
import { CreateSessionBody, SettingsInput } from "@/lib/validation";
import { buildVtt } from "@/lib/vtt";
import { formatClock, formatTimer } from "@/lib/format";
import { transition, type StudioState } from "@/lib/studio/machine";

describe("WAV", () => {
  it("encodes a valid 16 kHz mono PCM header", () => {
    const bytes = encodeWavPcm16(new Float32Array([0, 0.5, -0.5, 1, -1]));
    const text = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(bytes.length).toBe(44 + 10);
    const parsed = parseWav(bytes);
    expect(parsed.sampleRate).toBe(16000);
    expect(Array.from(parsed.samples)).toEqual([0, 16384, -16384, 32767, -32768]);
  });
  it("rejects other formats", () => {
    const bytes = encodeWavPcm16(new Float32Array(100), 44100);
    expect(() => parseWav(bytes)).toThrow(WavError);
    expect(() => parseWav(new Uint8Array(10))).toThrow(WavError);
  });
});

describe("chunk planner", () => {
  it("keeps short recordings in one chunk", () => {
    expect(planChunks(new Float32Array(16000 * 20))).toHaveLength(1);
  });
  it("cuts long recordings in the quietest window between 18 and 28 s", () => {
    const pcm = new Float32Array(16000 * 60).map((_, i) => Math.sin(i / 10) * 0.5);
    pcm.fill(0, 16000 * 22, 16000 * 22.3); // silence at 22 s
    const plan = planChunks(pcm);
    expect(plan[0]!.endMs).toBeGreaterThan(22_000);
    expect(plan[0]!.endMs).toBeLessThan(22_300);
    expect(plan.at(-1)!.endMs).toBe(60_000);
  });
  it("resamples linearly to the expected length", () => {
    expect(resampleLinear(new Float32Array(48000), 48000).length).toBe(16000);
  });
});

describe("identity tokens", () => {
  const id = "3f1c2a7e-8a9b-4c1d-9e2f-0a1b2c3d4e5f";
  it("round-trips and rejects tampering", () => {
    const t = signIdentity(id, "secret-a-secret-a-secret-a-secret-a");
    expect(verifyIdentity(t, "secret-a-secret-a-secret-a-secret-a")).toBe(id);
    expect(verifyIdentity(t, "secret-b-secret-b-secret-b-secret-b")).toBeNull();
    expect(verifyIdentity(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "secret-a-secret-a-secret-a-secret-a")).toBeNull();
    expect(verifyIdentity("garbage", "x")).toBeNull();
  });
});

describe("scoring", () => {
  it("applies the documented formulas", () => {
    expect(pacingScore(145, 10, 130, 160)).toBe(100);
    expect(pacingScore(180, 10, 130, 160)).toBe(50);
    expect(pacingScore(145, 40, 130, 160)).toBe(85);
    expect(fillersScore(2)).toBe(75);
    expect(pausesScore(1.5, 0.5)).toBe(75);
    expect(pausesScore(1.5, 1.0)).toBe(88);
    expect(audienceFitScore(100, 50)).toBe(70);
    expect(audienceFitScore(80, null)).toBe(80);
  });
  it("renormalizes weights when components are missing", () => {
    const full = overallScore({ pacing: 80, fillers: 80, pauses: 80, clarity: 80, structure: 80, audienceFit: 80 });
    expect(full).toBe(80);
    const partial = overallScore({ pacing: 100, fillers: 50, pauses: null, clarity: null, structure: null, audienceFit: null });
    expect(partial).toBe(75);
    expect(scoreLabel(85)).toBe("Excellent");
    expect(scoreLabel(54)).toBe("Needs work");
  });
  it("resolves audience profiles", () => {
    const settings = { targetWpmMin: 100, targetWpmMax: 120 };
    expect(resolveAudienceProfile("general", settings)).toMatchObject({ targetMin: 100, targetMax: 120, targetGrade: 10 });
    expect(resolveAudienceProfile("young", settings)).toMatchObject({ targetMin: 110, targetMax: 140, targetGrade: 5 });
    expect(resolveAudienceProfile("senior", settings).longPauseTolerance).toBe(1);
  });
});

describe("progress", () => {
  const p = (iso: string, overall = 70, timeZone = "UTC") => ({ completedAt: iso, timeZone, overall });
  it("counts streaks ending today or yesterday", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(computeStreak([p("2026-10-08T10:00:00Z"), p("2026-10-09T10:00:00Z"), p("2026-10-10T10:00:00Z")], now)).toBe(3);
    expect(computeStreak([p("2026-10-08T10:00:00Z"), p("2026-10-09T10:00:00Z")], now)).toBe(2);
    expect(computeStreak([p("2026-10-07T10:00:00Z")], now)).toBe(0);
  });
  it("uses each session's own time zone for its calendar day", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    // 02:00 UTC on Oct 10 is still Oct 9 in New York.
    expect(computeStreak([p("2026-10-10T02:00:00Z", 70, "America/New_York"), p("2026-10-10T11:00:00Z", 70, "America/New_York")], now)).toBe(2);
  });
  it("reports trend with thresholds", () => {
    const mk = (scores: number[]) => scores.map((s, i) => p(`2026-10-0${i + 1}T10:00:00Z`, s));
    expect(computeTrend(mk([60, 60, 60, 70, 70]))).toEqual({ kind: "insufficient", delta: null });
    expect(computeTrend(mk([60, 60, 60, 70, 70, 70]))).toEqual({ kind: "improving", delta: 10 });
    expect(computeTrend(mk([70, 70, 70, 69, 69, 69]))).toEqual({ kind: "steady", delta: -1 });
    expect(computeTrend(mk([80, 80, 80, 70, 70, 70])).kind).toBe("declining");
  });
});

describe("validation", () => {
  it("validates session creation", () => {
    const ok = CreateSessionBody.safeParse({ durationMs: 60_000, expectedChunks: 3, videoCaptured: true, timeZone: "Mars/Base", audience: "teen" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.timeZone).toBe("UTC");
    expect(CreateSessionBody.safeParse({ durationMs: 300_000, expectedChunks: 2, videoCaptured: false, timeZone: "UTC" }).success).toBe(false);
    expect(CreateSessionBody.safeParse({ durationMs: 5_000, expectedChunks: 1, videoCaptured: false, timeZone: "UTC" }).success).toBe(false);
  });
  it("validates settings", () => {
    const base = { displayName: "Ana", defaultAudience: "teen", targetWpmMin: "120", targetWpmMax: "150", customFillers: ["Basically", "you know"], motionPreference: "system", autoAdvanceReport: true };
    const ok = SettingsInput.safeParse(base);
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.customFillers).toEqual(["basically", "you know"]);
    expect(SettingsInput.safeParse({ ...base, targetWpmMin: "160", targetWpmMax: "150" }).success).toBe(false);
    expect(SettingsInput.safeParse({ ...base, customFillers: ["no-dashes"] }).success).toBe(false);
  });
});

describe("format and captions", () => {
  it("formats clocks and builds WebVTT", () => {
    expect(formatClock(75_000)).toBe("1:15");
    expect(formatTimer(75_000)).toBe("01:15");
    const vtt = buildVtt([{ startMs: 0, endMs: 1500, text: "Hello <world>" }]);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:01.500");
    expect(vtt).toContain("Hello &lt;world&gt;");
  });
});

describe("mic check", () => {
  it("reports too quiet after 1.5 s below -50 dBFS", () => {
    const c = new MicCheck();
    expect(c.update(-70, -60, 0)).toBe("good");
    expect(c.update(-70, -60, 1600)).toBe("quiet");
  });
});

describe("studio machine", () => {
  it("only reaches recording through the countdown", () => {
    let s: StudioState = { kind: "ready", audioOnly: false };
    expect(transition(s, { type: "BEGIN_RECORDING", now: 0 })).toBe(s);
    s = transition(s, { type: "START" });
    s = transition(s, { type: "TICK" });
    s = transition(s, { type: "TICK" });
    expect(s).toMatchObject({ kind: "countdown", remaining: 1 });
    s = transition(s, { type: "BEGIN_RECORDING", now: 100 });
    expect(s.kind).toBe("recording");
  });
  it("sends short takes to tooShort and long takes to submitting", () => {
    const fin: StudioState = { kind: "finalizing", audioOnly: false };
    expect(transition(fin, { type: "FINALIZED", capturedMs: 9_999 }).kind).toBe("tooShort");
    expect(transition(fin, { type: "FINALIZED", capturedMs: 10_000 }).kind).toBe("submitting");
  });
  it("excludes paused time from elapsed", () => {
    let s: StudioState = { kind: "recording", startedAt: 0, accumulatedMs: 0, audioOnly: false };
    s = transition(s, { type: "PAUSE", now: 5_000 });
    expect(s).toMatchObject({ kind: "paused", accumulatedMs: 5_000 });
    s = transition(s, { type: "RESUME", now: 60_000 });
    expect(s).toMatchObject({ kind: "recording", startedAt: 60_000, accumulatedMs: 5_000 });
  });
});

describe("design tokens", () => {
  // WCAG 2.x relative luminance contrast, design §12.1 (R16.1).
  const css = readFileSync("src/app/globals.css", "utf8");
  const token = (name: string) => {
    const m = css.match(new RegExp(`--sr-${name}:\\s*(#[0-9a-f]{6})`, "i"));
    if (!m?.[1]) throw new Error(`missing token ${name}`);
    return m[1];
  };
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(token(a)), lum(token(b))];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  it.each([
    ["text", "surface-raised", 4.5],
    ["text-secondary", "surface-raised", 4.5],
    ["text-muted", "surface-raised", 4.5],
    ["text-muted", "canvas", 4.5],
    ["on-primary", "primary", 4.5],
    ["on-record", "record", 4.5],
    ["primary-soft", "surface", 4.5],
    ["danger", "surface", 4.5],
    ["success", "surface", 4.5],
    ["warning", "surface", 4.5],
    ["border-strong", "surface-raised", 3],
    ["focus", "surface-raised", 3],
    ["data-1", "surface", 3],
    ["data-2", "surface", 3],
    ["data-3", "surface", 3],
    ["data-4", "surface", 3],
    ["data-5", "surface", 3],
  ])("%s on %s meets %s:1", (fg, bg, min) => {
    expect(ratio(fg as string, bg as string)).toBeGreaterThanOrEqual(min as number);
  });
});
