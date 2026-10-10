/**
 * Correctness properties P1–P15 (design §17.1), checked with fast-check.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planChunks, SAMPLE_RATE } from "@/lib/audio/chunker";
import { encodeWavPcm16 } from "@/lib/audio/wav";
import { parseWav, WavError } from "@/server/audio/wav-parse";
import { detectSilences, MIN_SILENCE_MS } from "@/server/analysis/silence";
import { mapTimestamps } from "@/server/hf/asr";
import { assembleTranscript, type ChunkTranscript } from "@/server/analysis/transcript";
import { computeMetrics } from "@/server/analysis/metrics";
import { detectFillers, resolveFillers } from "@/server/analysis/fillers";
import { audienceFitScore, overallScore, pacingScore, pausesScore, WEIGHTS } from "@/lib/scoring";
import { extractJson, normalizeCoaching, parseCoaching } from "@/server/hf/parse";
import { transition, MIN_RECORDING_MS, type StudioEvent, type StudioState } from "@/lib/studio/machine";
import { computeStreak, computeTrend } from "@/lib/progress";
import { signIdentity, verifyIdentity } from "@/server/auth/token";
import { readabilityScore, readingGrade } from "@/server/analysis/readability";
import { resolveAudienceProfile } from "@/lib/audience";
import { AUDIENCES } from "@/lib/types";
import { normalizeToken } from "@/lib/text";
import type { CoachingFeedback } from "@/lib/coaching";

const RUNS = process.env.CI ? 500 : 100;
const opts = { numRuns: RUNS };

describe("P1 chunk planner", () => {
  it("covers [0, n] contiguously with 18–28 s chunks, at most 17 for ≤ 5 min", () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 300 }), fc.integer({ min: 0, max: 1_000_000 }), (sec, seed) => {
        const n = sec * SAMPLE_RATE;
        const pcm = new Float32Array(n);
        let x = seed || 1;
        for (let i = 0; i < n; i += 37) {
          x = (x * 1103515245 + 12345) & 0x7fffffff;
          pcm[i] = ((x % 2000) - 1000) / 1000;
        }
        const plan = planChunks(pcm);
        expect(plan[0]!.startSample).toBe(0);
        expect(plan.at(-1)!.endSample).toBe(n);
        plan.forEach((c, i) => {
          if (i > 0) expect(c.startSample).toBe(plan[i - 1]!.endSample);
          const len = c.endSample - c.startSample;
          expect(len).toBeGreaterThan(0);
          expect(len).toBeLessThanOrEqual(28 * SAMPLE_RATE);
          if (i < plan.length - 1) expect(len).toBeGreaterThanOrEqual(18 * SAMPLE_RATE);
          expect(c.endMs - c.startMs).toBeLessThanOrEqual(28_500);
        });
        expect(plan.length).toBeLessThanOrEqual(17);
      }),
      { numRuns: Math.min(RUNS, 40) },
    );
  });
});

describe("P2 WAV round trip", () => {
  it("parse(encode(x)) preserves samples within 1 LSB; header corruption is rejected", () => {
    fc.assert(
      fc.property(fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 400 }), fc.integer({ min: 0, max: 43 }), (samples, byte) => {
        const bytes = encodeWavPcm16(new Float32Array(samples));
        const parsed = parseWav(bytes);
        expect(parsed.samples.length).toBe(samples.length);
        samples.forEach((s, i) => {
          const expected = s < 0 ? s * 0x8000 : s * 0x7fff;
          expect(Math.abs(parsed.samples[i]! - expected)).toBeLessThanOrEqual(1);
        });
        // Corrupt one structural header byte (skip size bytes that may stay consistent).
        const structural = [0, 1, 2, 3, 8, 9, 10, 11, 20, 22, 24, 34, 36, 37, 38, 39];
        const pos = structural[byte % structural.length]!;
        const copy = bytes.slice();
        copy[pos] = (copy[pos]! + 1) % 256;
        expect(() => parseWav(copy)).toThrow(WavError);
      }),
      opts,
    );
  });
});

describe("P3 silence detection", () => {
  it("returns sorted, non-overlapping intervals of ≥ 300 ms inside the span", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 1, max: 40 })), { minLength: 1, maxLength: 20 }), fc.integer({ min: 0, max: 60_000 }), (runs, offset) => {
        const parts = runs.map(([loud, frames]) => {
          const n = frames * 320;
          const a = new Int16Array(n);
          if (loud) for (let i = 0; i < n; i++) a[i] = Math.round(9000 * Math.sin(i / 3));
          return a;
        });
        const pcm = new Int16Array(parts.reduce((s, p) => s + p.length, 0));
        let o = 0;
        for (const p of parts) {
          pcm.set(p, o);
          o += p.length;
        }
        const r = detectSilences(pcm, 16000, offset);
        const span = (pcm.length / 16000) * 1000;
        expect(r.voicedRatio).toBeGreaterThanOrEqual(0);
        expect(r.voicedRatio).toBeLessThanOrEqual(1);
        r.silences.forEach((s, i) => {
          expect(s.endMs - s.startMs).toBeGreaterThanOrEqual(MIN_SILENCE_MS);
          expect(s.startMs).toBeGreaterThanOrEqual(offset);
          expect(s.endMs).toBeLessThanOrEqual(offset + span + 1);
          if (i > 0) expect(s.startMs).toBeGreaterThanOrEqual(r.silences[i - 1]!.endMs);
        });
      }),
      opts,
    );
  });
});

describe("P4 ASR timestamp mapping", () => {
  it("is monotonic, clamped, and end ≥ start for any input", () => {
    const ts = fc.oneof(fc.constant(null), fc.double({ min: -10, max: 60, noNaN: true }));
    fc.assert(
      fc.property(fc.array(fc.record({ text: fc.string({ minLength: 1, maxLength: 12 }), timestamp: fc.tuple(ts, ts) }), { maxLength: 30 }), fc.integer({ min: 0, max: 200_000 }), fc.integer({ min: 1, max: 28_000 }), (chunks, start, len) => {
        const end = start + len;
        const out = mapTimestamps(chunks, start, end);
        out.forEach((s, i) => {
          expect(s.startMs).toBeGreaterThanOrEqual(start);
          expect(s.endMs).toBeLessThanOrEqual(end);
          expect(s.endMs).toBeGreaterThanOrEqual(s.startMs);
          if (i > 0) expect(s.startMs).toBeGreaterThanOrEqual(out[i - 1]!.startMs);
        });
      }),
      opts,
    );
  });
});

const wordArb = fc.constantFrom("so", "today", "um", "like", "we", "build", "great", "things", "you", "know", "really", "okay", "uh");

describe("P5 transcript assembly", () => {
  it("keeps word timing monotonic and inside its segment; counts match", () => {
    fc.assert(
      fc.property(fc.array(fc.array(wordArb, { minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 6 }), fc.boolean(), (segs, withTs) => {
        const chunks: ChunkTranscript[] = segs.map((ws, i) => ({
          index: i,
          startMs: i * 10_000,
          endMs: (i + 1) * 10_000,
          text: ws.join(" "),
          segments: withTs ? [{ text: ws.join(" "), startMs: i * 10_000 + 100, endMs: i * 10_000 + 9_000 }] : null,
          wordLevel: false,
          silences: [{ startMs: i * 10_000, endMs: i * 10_000 + 400 }],
        }));
        const t = assembleTranscript(chunks);
        expect(t.wordCount).toBe(t.segments.map((s) => s.text).join(" ").split(/\s+/).filter(Boolean).length);
        t.words.forEach((w, i) => {
          const seg = t.segments[w.segmentSeq]!;
          expect(w.startMs).toBeGreaterThanOrEqual(seg.startMs);
          expect(w.endMs).toBeLessThanOrEqual(seg.endMs);
          if (i > 0) expect(w.startMs).toBeGreaterThanOrEqual(t.words[i - 1]!.startMs);
        });
      }),
      opts,
    );
  });
});

describe("P6 metrics", () => {
  it("is deterministic and bounded", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10_000, max: 300_000 }),
        fc.array(fc.integer({ min: 0, max: 300_000 }), { maxLength: 200 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 300_000 }), fc.integer({ min: 0, max: 8_000 })), { maxLength: 30 }),
        (duration, starts, sil) => {
          const words = starts.filter((s) => s < duration).sort((a, b) => a - b).map((s) => ({ startMs: s, endMs: Math.min(duration, s + 200) }));
          const input = { durationMs: duration, words, silences: sil.map(([s, l]) => ({ startMs: s, endMs: s + l })), fillerCount: 0, fillerBreakdown: {} };
          const a = computeMetrics(input);
          expect(computeMetrics(input)).toEqual(a);
          expect(a.wpm).toBeGreaterThanOrEqual(0);
          expect(a.pauseRatio).toBeGreaterThanOrEqual(0);
          expect(a.pauseRatio).toBeLessThanOrEqual(1);
          expect(a.longPauseCount).toBeLessThanOrEqual(a.pauseCount);
          expect(a.longestPauseMs).toBeLessThanOrEqual(a.durationMs);
          expect(a.speakingMs).toBeLessThanOrEqual(a.durationMs);
          expect(a.wpmTimeline.reduce((s, w) => s + w.words, 0)).toBe(a.wordCount);
        },
      ),
      opts,
    );
  });
});

describe("P7 fillers", () => {
  it("count = unambiguous + valid confirmations; the model can't inflate it", () => {
    fc.assert(
      fc.property(fc.array(wordArb, { maxLength: 60 }), fc.array(fc.string({ maxLength: 5 }), { maxLength: 40 }), (ws, ids) => {
        const words = ws.map((w, i) => ({ seq: i, word: w, norm: normalizeToken(w), startMs: i * 300 }));
        const d = detectFillers(words);
        const rules = resolveFillers(d, null);
        expect(rules.count).toBe(d.unambiguous.length);
        const fake = resolveFillers(d, [...ids, ...d.candidates.map((c) => c.id), ...d.candidates.map((c) => c.id)]);
        expect(fake.count).toBe(d.unambiguous.length + Math.min(150, d.candidates.length));
        const perPhrase = new Map<string, number>();
        d.candidates.forEach((c) => perPhrase.set(c.phrase, (perPhrase.get(c.phrase) ?? 0) + 1));
        for (const [phrase, v] of Object.entries(fake.breakdown)) {
          if (v.confirmed) expect(v.count).toBeLessThanOrEqual(perPhrase.get(phrase) ?? 0);
        }
        const bogus = resolveFillers(d, ids.map((x) => `zz${x}`));
        expect(bogus.count).toBe(d.unambiguous.length);
      }),
      opts,
    );
  });
});

describe("P8 scoring", () => {
  const s = fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 100 }));
  it("keeps scores in 0–100 and overall between component extremes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), s, s, fc.integer({ min: 0, max: 100 }), (pacing, fillers, pauses, clarity, structure, fit) => {
        const comps = { pacing, fillers, pauses, clarity, structure, audienceFit: fit };
        const o = overallScore(comps);
        const vals = Object.values(comps).filter((v): v is number => v !== null);
        expect(Number.isInteger(o)).toBe(true);
        expect(o).toBeGreaterThanOrEqual(Math.min(...vals) - 1);
        expect(o).toBeLessThanOrEqual(Math.max(...vals) + 1);
      }),
      opts,
    );
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
  it("pacing is non-increasing with distance from the band", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 60 }), (d1, d2, stddev) => {
        const [near, far] = d1 <= d2 ? [d1, d2] : [d2, d1];
        expect(pacingScore(160 + far, stddev, 130, 160)).toBeLessThanOrEqual(pacingScore(160 + near, stddev, 130, 160));
        expect(pacingScore(130 - far, stddev, 130, 160)).toBeLessThanOrEqual(pacingScore(130 - near, stddev, 130, 160));
      }),
      opts,
    );
  });
});

const coachingArb: fc.Arbitrary<CoachingFeedback> = fc.record({
  schemaVersion: fc.constant(1 as const),
  summary: fc.string({ minLength: 20, maxLength: 60 }).filter((x) => x.trim().length >= 20),
  clarity: fc.record({ score: fc.integer({ min: 0, max: 100 }), rationale: fc.constant("Clear and concrete.") }),
  structure: fc.record({ score: fc.integer({ min: 0, max: 100 }), hasClearOpening: fc.boolean(), hasClearClosing: fc.boolean(), rationale: fc.constant("Has a hook {and} a close.") }),
  audienceFit: fc.record({ score: fc.integer({ min: 0, max: 100 }), rationale: fc.constant("Fits the audience well."), tips: fc.constant(["Add one more question."]) }),
  pacingInsight: fc.constant('Steady "pace" overall.'),
  fillerReview: fc.record({ confirmedCandidateIds: fc.array(fc.constantFrom("c1", "c2", "c3", "c40"), { maxLength: 6 }), note: fc.constant("") }),
  strengths: fc.constant([{ title: "Hook", detail: "Strong opening story." }]),
  improvements: fc.array(
    fc.record({
      title: fc.constant("Fix this"),
      detail: fc.constant("Detailed advice here."),
      category: fc.constantFrom("pacing", "fillers", "audience"),
      priority: fc.constantFrom("high", "medium", "low"),
      evidenceQuote: fc.oneof(fc.constant(null), fc.constantFrom("we build great things", "not in transcript at all", "a b c d e f g h i j k l m n o p q r s t u v")),
      suggestedRewrite: fc.constant(null),
    }),
    { minLength: 1, maxLength: 5 },
  ),
  practiceDrill: fc.constant({ title: "Drill", instructions: "Practice the opening three times.", durationMinutes: 5 }),
}) as fc.Arbitrary<CoachingFeedback>;

describe("P9 LLM parsing", () => {
  it("recovers JSON from fences/prose and normalization is idempotent and safe", () => {
    fc.assert(
      fc.property(coachingArb, fc.constantFrom("", "Sure! ", "```json\n", "Here {is} it:\n"), (fb, prefix) => {
        const raw = prefix + JSON.stringify(fb) + (prefix.startsWith("```") ? "\n```" : " Thanks.");
        const parsed = parseCoaching(raw);
        expect(parsed.ok).toBe(true);
        expect(JSON.parse(extractJson(raw)!)).toEqual(fb);
        const ctx = { candidateIds: new Set(["c1", "c2"]), transcript: "So today we build great things" };
        const once = normalizeCoaching(fb, ctx);
        expect(normalizeCoaching(once, ctx)).toEqual(once);
        once.improvements.forEach((imp) => {
          if (imp.evidenceQuote) expect(imp.evidenceQuote.split(/\s+/).length).toBeLessThanOrEqual(20);
        });
        expect(new Set(once.fillerReview.confirmedCandidateIds).size).toBe(once.fillerReview.confirmedCandidateIds.length);
      }),
      opts,
    );
  });
});

const eventArb: fc.Arbitrary<StudioEvent> = fc.oneof(
  fc.constantFrom<StudioEvent>(
    { type: "PERMISSION_UNKNOWN" },
    { type: "PERMISSION_GRANTED" },
    { type: "ENABLE" },
    { type: "ACQUIRED", audioOnly: false },
    { type: "ACQUIRE_FAILED", reason: "not-allowed", canUseMicOnly: true },
    { type: "RETRY" },
    { type: "MIC_ONLY" },
    { type: "START" },
    { type: "TICK" },
    { type: "CANCEL" },
    { type: "STOP" },
    { type: "DISCARD" },
    { type: "ANALYZE_PARTIAL" },
    { type: "RECORD_AGAIN" },
    { type: "RETRY_SUBMIT" },
    { type: "SUBMIT_OK", sessionId: "s" },
    { type: "SUBMIT_FAILED", code: "INTERNAL", message: "x", retryable: true },
  ),
  fc.integer({ min: 0, max: 400_000 }).map((n): StudioEvent => ({ type: "PAUSE", now: n })),
  fc.integer({ min: 0, max: 400_000 }).map((n): StudioEvent => ({ type: "RESUME", now: n })),
  fc.integer({ min: 0, max: 400_000 }).map((n): StudioEvent => ({ type: "BEGIN_RECORDING", now: n })),
  fc.integer({ min: 0, max: 30_000 }).map((n): StudioEvent => ({ type: "FINALIZED", capturedMs: n })),
  fc.integer({ min: 0, max: 30_000 }).map((n): StudioEvent => ({ type: "TRACK_ENDED", capturedMs: n })),
);

describe("P10 studio machine", () => {
  it("reaches recording only from countdown and submitting only with ≥ 10 s", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 60 }), (events) => {
        let s: StudioState = { kind: "checking" };
        for (const e of events) {
          const next = transition(s, e);
          if (next.kind === "recording" && s.kind !== "recording") expect(["countdown", "paused"]).toContain(s.kind);
          if (next.kind === "submitting" && s.kind === "finalizing") {
            expect(e.type).toBe("FINALIZED");
            if (e.type === "FINALIZED") expect(e.capturedMs).toBeGreaterThanOrEqual(MIN_RECORDING_MS);
          }
          if (next !== s) expect(typeof next.kind).toBe("string");
          s = next;
        }
      }),
      opts,
    );
  });
});

describe("P11 progress", () => {
  const point = fc.record({
    completedAt: fc.integer({ min: Date.parse("2026-01-01"), max: Date.parse("2026-10-10") }).map((t) => new Date(t).toISOString()),
    timeZone: fc.constantFrom("UTC", "America/New_York", "Asia/Tokyo"),
    overall: fc.integer({ min: 0, max: 100 }),
  });
  it("streak is bounded by distinct days and trend follows thresholds", () => {
    fc.assert(
      fc.property(fc.array(point, { maxLength: 30 }), (pts) => {
        const now = new Date("2026-10-10T12:00:00Z");
        const streak = computeStreak(pts, now);
        expect(streak).toBeGreaterThanOrEqual(0);
        expect(streak).toBeLessThanOrEqual(pts.length);
        const trend = computeTrend(pts);
        if (pts.length < 6) expect(trend.kind).toBe("insufficient");
        else if (trend.kind !== "insufficient") {
          if (trend.delta >= 3) expect(trend.kind).toBe("improving");
          else if (trend.delta <= -3) expect(trend.kind).toBe("declining");
          else expect(trend.kind).toBe("steady");
        }
      }),
      opts,
    );
  });
  it("adding a session on an already-counted day doesn't change the streak", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 0, max: 5 }), (days, extra) => {
        const pts = Array.from({ length: days }, (_, i) => ({ completedAt: new Date(now.getTime() - i * 86_400_000).toISOString(), timeZone: "UTC", overall: 70 }));
        const base = computeStreak(pts, now);
        const dup = [...pts, { ...pts[extra % pts.length]!, completedAt: new Date(Date.parse(pts[extra % pts.length]!.completedAt) - 60_000).toISOString() }];
        expect(computeStreak(dup, now)).toBe(base);
      }),
      opts,
    );
  });
});

describe("P12 identity", () => {
  it("verify(sign(id)) = id, and any single-character change fails", () => {
    const secret = "property-secret-property-secret-1234";
    fc.assert(
      fc.property(fc.uuid({ version: 4 }), fc.nat(), (id, pos) => {
        const token = signIdentity(id, secret);
        expect(verifyIdentity(token, secret)).toBe(id);
        const i = pos % token.length;
        const ch = token[i] === "a" ? "b" : "a";
        const tampered = token.slice(0, i) + ch + token.slice(i + 1);
        if (tampered.toLowerCase() !== token.toLowerCase() || token[i] !== tampered[i]) {
          const v = verifyIdentity(tampered, secret);
          // UUIDs are case-insensitive; only a byte-identical ID may verify.
          expect(v === null || v.toLowerCase() === id.toLowerCase()).toBe(true);
          if (i >= token.lastIndexOf(".")) expect(v).toBeNull();
        }
      }),
      opts,
    );
  });
});

describe("P13 pipeline status model", () => {
  type Status = "created" | "uploading" | "transcribed" | "analyzing" | "complete" | "failed";
  const ORDER: Record<Status, number> = { created: 0, uploading: 1, transcribed: 2, analyzing: 3, complete: 5, failed: 4 };
  /** In-memory model of the conditional updates in queries/sessions.ts and chunks.ts. */
  function model(expected: number) {
    const st = { status: "created" as Status, attempts: 0, done: new Set<number>(), claimed: false, derived: false };
    return {
      st,
      chunk(i: number) {
        if (!["created", "uploading"].includes(st.status)) return;
        st.done.add(i);
        st.status = st.done.size >= expected ? "transcribed" : "uploading";
      },
      claim(stale: boolean) {
        const ok =
          st.attempts < 3 &&
          (st.status === "transcribed" ||
            (["created", "uploading"].includes(st.status) && st.done.size >= expected) ||
            st.status === "failed" ||
            (st.status === "analyzing" && stale));
        if (ok) {
          st.status = "analyzing";
          st.attempts++;
          st.claimed = true;
        }
        return ok;
      },
      complete() {
        if (st.status !== "analyzing") return;
        st.derived = true;
        st.status = "complete";
      },
      fail() {
        if (st.status === "analyzing") st.status = "failed";
      },
    };
  }
  it("never moves backwards (except failed → retry), ≤ 3 attempts, complete ⇒ derived rows", () => {
    const op = fc.oneof(
      fc.integer({ min: 0, max: 4 }).map((i) => ({ k: "chunk" as const, i })),
      fc.boolean().map((stale) => ({ k: "claim" as const, stale })),
      fc.constant({ k: "complete" as const }),
      fc.constant({ k: "fail" as const }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.array(op, { maxLength: 40 }), (expected, ops) => {
        const m = model(expected);
        for (const o of ops) {
          const before = m.st.status;
          if (o.k === "chunk") m.chunk(o.i % expected);
          else if (o.k === "claim") m.claim(o.stale);
          else if (o.k === "complete") m.complete();
          else m.fail();
          const after = m.st.status;
          if (!(before === "failed" && after === "analyzing") && !(before === "analyzing" && after === "analyzing")) {
            expect(ORDER[after]).toBeGreaterThanOrEqual(ORDER[before]);
          }
          if (before === "complete") expect(after).toBe("complete");
          expect(m.st.attempts).toBeLessThanOrEqual(3);
          if (after === "complete") expect(m.st.derived).toBe(true);
        }
      }),
      opts,
    );
  });
});

describe("P14 readability", () => {
  it("is deterministic, bounded, and ignores bare filler tokens", () => {
    fc.assert(
      fc.property(fc.array(fc.array(wordArb.filter((w) => !["um", "uh"].includes(w)), { minLength: 1, maxLength: 15 }), { minLength: 1, maxLength: 5 }), fc.integer({ min: 0, max: 14 }), (segs, at) => {
        const texts = segs.map((s) => s.join(" ") + ".");
        const g = readingGrade({ segments: texts });
        expect(readingGrade({ segments: texts })).toBe(g);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(18);
        const withFillers = texts.map((t) => {
          const parts = t.split(" ");
          parts.splice(Math.min(at, parts.length - 1), 0, "um", "uh");
          return parts.join(" ");
        });
        expect(readingGrade({ segments: withFillers })).toBe(g);
        expect(readabilityScore(Math.min(g, 5), 5)).toBe(100);
        expect(readabilityScore(g + 1, 5)).toBeLessThanOrEqual(readabilityScore(g, 5));
      }),
      opts,
    );
  });
});

describe("P15 audience profiles", () => {
  it("is total; only general reads settings; higher tolerance never lowers the pauses score", () => {
    fc.assert(
      fc.property(fc.constantFrom(...AUDIENCES), fc.integer({ min: 80, max: 200 }), fc.integer({ min: 0, max: 20 }), fc.double({ min: 0, max: 5, noNaN: true }), fc.integer({ min: 0, max: 100 }), (aud, min, gap, lppm, readability) => {
        const settings = { targetWpmMin: min, targetWpmMax: min + 1 + gap };
        const p = resolveAudienceProfile(aud, settings);
        if (aud === "general") expect([p.targetMin, p.targetMax]).toEqual([settings.targetWpmMin, settings.targetWpmMax]);
        else expect(p.targetMin).toBe(resolveAudienceProfile(aud, { targetWpmMin: 99, targetWpmMax: 199 }).targetMin);
        const general = resolveAudienceProfile("general", settings);
        if (aud === "young" || aud === "senior") {
          expect(pausesScore(lppm, p.longPauseTolerance)).toBeGreaterThanOrEqual(pausesScore(lppm, general.longPauseTolerance));
        }
        const fit = audienceFitScore(readability, null);
        expect(fit).toBe(readability);
        expect(audienceFitScore(readability, 50)).toBeGreaterThanOrEqual(0);
        expect(audienceFitScore(readability, 50)).toBeLessThanOrEqual(100);
      }),
      opts,
    );
  });
});
