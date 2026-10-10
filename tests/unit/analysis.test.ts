import { describe, expect, it } from "vitest";
import { detectFillers, resolveFillers } from "@/server/analysis/fillers";
import { buildTimeline, computeMetrics } from "@/server/analysis/metrics";
import { countSyllables, readabilityScore, readingGrade } from "@/server/analysis/readability";
import { detectSilences } from "@/server/analysis/silence";
import { assembleTranscript, type ChunkTranscript } from "@/server/analysis/transcript";
import { finalizeAnalysis, NoSpeechError, prepareAnalysis } from "@/server/analysis/analyze";
import { normalizeToken } from "@/lib/text";

const words = (text: string, startMs = 0, stepMs = 400) =>
  text.split(" ").map((w, i) => ({ seq: i, word: w, norm: normalizeToken(w), startMs: startMs + i * stepMs }));

function tone(ms: number, amp = 8000, rate = 16000): Int16Array {
  const n = Math.round((ms / 1000) * rate);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(amp * Math.sin((2 * Math.PI * 220 * i) / rate));
  return out;
}
function concat(...parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("silence detection", () => {
  it("finds a silent gap between tones and reports voiced ratio", () => {
    const pcm = concat(tone(1000), new Int16Array(16000), tone(1000));
    const r = detectSilences(pcm, 16000, 5000);
    expect(r.silences).toHaveLength(1);
    const s = r.silences[0]!;
    expect(s.startMs).toBeGreaterThanOrEqual(5980);
    expect(s.endMs).toBeLessThanOrEqual(7020);
    expect(r.voicedRatio).toBeGreaterThan(0.6);
    expect(r.voicedRatio).toBeLessThan(0.7);
  });
  it("treats all-zero audio as fully silent", () => {
    const r = detectSilences(new Int16Array(16000 * 2), 16000);
    expect(r.voicedRatio).toBe(0);
  });
  it("ignores gaps shorter than 300 ms", () => {
    const pcm = concat(tone(500), new Int16Array(3200), tone(500)); // 200 ms gap
    expect(detectSilences(pcm, 16000).silences).toHaveLength(0);
  });
});

describe("filler detection", () => {
  it("counts unambiguous fillers and finds contextual candidates", () => {
    const d = detectFillers(words("Um so I was like you know really nervous uh okay"));
    expect(d.unambiguous.map((u) => u.phrase)).toEqual(["um", "uh"]);
    expect(d.candidates.map((c) => c.phrase)).toEqual(["so", "like", "you know", "okay"]);
    expect(d.candidates[2]!.span).toBe(2);
    expect(d.candidates[1]!.context).toContain("[like]");
  });
  it("treats custom fillers as contextual and handles phrases", () => {
    const d = detectFillers(words("To be honest the plan is to be honest simple"), ["To be honest"]);
    expect(d.candidates.filter((c) => c.phrase === "to be honest")).toHaveLength(2);
  });
  it("applies only known confirmations and excludes candidates under rules", () => {
    const d = detectFillers(words("um like so like"));
    const rules = resolveFillers(d, null);
    expect(rules.count).toBe(1);
    const llm = resolveFillers(d, ["c1", "c1", "c99", "bogus"]);
    expect(llm.count).toBe(2);
    expect(llm.breakdown.like).toEqual({ count: 1, confirmed: true });
  });
});

describe("metrics", () => {
  it("computes WPM, pauses, and the timeline deterministically", () => {
    const ws = Array.from({ length: 60 }, (_, i) => ({ startMs: 1000 + i * 450, endMs: 1300 + i * 450 }));
    const input = {
      durationMs: 30_000,
      words: ws,
      silences: [
        { startMs: 0, endMs: 900 },
        { startMs: 10_000, endMs: 12_500 },
        { startMs: 20_000, endMs: 20_700 },
        { startMs: 28_000, endMs: 30_000 },
      ],
      fillerCount: 2,
      fillerBreakdown: { um: { count: 2, confirmed: false } },
    };
    const a = computeMetrics(input);
    const b = computeMetrics(input);
    expect(a).toEqual(b);
    expect(a.pauseCount).toBe(2);
    expect(a.longPauseCount).toBe(1);
    expect(a.longestPauseMs).toBe(2500);
    expect(a.wpm).toBeGreaterThan(100);
    expect(a.wpmTimeline.reduce((s, w) => s + w.words, 0)).toBe(60);
  });
  it("merges a final short window into the previous one", () => {
    const tl = buildTimeline([{ startMs: 0 }, { startMs: 16_000 }, { startMs: 31_000 }], 33_000);
    expect(tl).toHaveLength(2);
    expect(tl[1]!.endMs).toBe(33_000);
  });
});

describe("readability", () => {
  it("counts syllables heuristically", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("table")).toBe(2);
    expect(countSyllables("beautiful")).toBe(3);
  });
  it("rates simple speech below complex speech", () => {
    const simple = readingGrade({ segments: ["The cat sat on the mat.", "It was fun."] });
    const complex = readingGrade({
      segments: ["Organizational transformation necessitates comprehensive stakeholder alignment and institutional accountability."],
    });
    expect(simple).toBeLessThan(complex);
    expect(readabilityScore(simple, 5)).toBe(100);
    expect(readabilityScore(complex, 5)).toBeLessThan(50);
  });
});

function chunk(index: number, startMs: number, endMs: number, text: string): ChunkTranscript {
  return { index, startMs, endMs, text, segments: [{ text, startMs, endMs }], wordLevel: false, silences: [] };
}

describe("transcript and full analysis", () => {
  const text =
    "So today I want to talk about why practice matters more than talent and um how small habits like recording yourself help a lot";
  it("assembles words with monotonic timing inside segments", () => {
    const t = assembleTranscript([chunk(1, 10_000, 20_000, "second part here."), chunk(0, 0, 10_000, text)]);
    expect(t.segments[0]!.startMs).toBe(0);
    for (let i = 1; i < t.words.length; i++) expect(t.words[i]!.startMs).toBeGreaterThanOrEqual(t.words[i - 1]!.startMs);
    expect(t.timingGranularity).toBe("asr_segment");
  });
  it("rejects transcripts with fewer than 15 words", () => {
    expect(() => prepareAnalysis([chunk(0, 0, 10_000, "too short to analyze")], { targetWpmMin: 130, targetWpmMax: 160, customFillers: [] }, "general")).toThrow(NoSpeechError);
  });
  it("uses rules feedback with readability-only audience fit when the LLM fails", () => {
    const prep = prepareAnalysis([chunk(0, 0, 12_000, text)], { targetWpmMin: 130, targetWpmMax: 160, customFillers: [] }, "young");
    const out = finalizeAnalysis(prep, { source: "rules" });
    expect(out.source).toBe("rules");
    expect(out.scores.clarity).toBeNull();
    expect(out.scores.audienceFitSource).toBe("readability_only");
    expect(out.scores.audienceFit).toBe(out.scores.readability);
    expect(out.profile.targetMin).toBe(110);
    expect(out.feedback.audienceFit.tips.length).toBeGreaterThan(0);
  });
});
