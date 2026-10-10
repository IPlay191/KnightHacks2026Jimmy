import "server-only";
import type { CoachingFeedback } from "@/lib/coaching";
import type { AsrChunkInput, AsrResult } from "./asr";

/**
 * Deterministic fixture responses used when HF_MOCK=1 (local dev and E2E
 * only; rejected in production by env validation). No network calls.
 */
const SCRIPT = [
  "So today I want to talk about why practice matters more than talent.",
  "Um, when I started speaking in public I was honestly terrified.",
  "I would, like, rush through every slide and forget my main point.",
  "Then I started recording myself every single week.",
  "You know, the first recordings were hard to watch.",
  "But each time I noticed one habit and fixed just that one thing.",
  "After a month my pace slowed down and my pauses felt intentional.",
  "Uh, the biggest change was confidence, not vocabulary.",
  "So here is my ask for you today.",
  "Record one short talk this week and listen back with kind ears.",
  "Pick one thing to improve and practice it again tomorrow.",
  "That small loop is how speakers actually get better.",
];

export const MOCK_ASR_MODEL = "mock/whisper";
export const MOCK_LLM_MODEL = "mock/llama";

export function mockTranscribe(input: AsrChunkInput): AsrResult {
  const span = input.endMs - input.startMs;
  const perSentenceMs = 4200;
  const count = Math.max(1, Math.floor(span / perSentenceMs));
  const offset = Math.floor(input.startMs / perSentenceMs);
  const segments = [];
  for (let i = 0; i < count; i++) {
    const text = SCRIPT[(offset + i) % SCRIPT.length] ?? SCRIPT[0]!;
    const s = input.startMs + i * perSentenceMs;
    const e = Math.min(input.endMs, s + perSentenceMs - 600);
    segments.push({ text, startMs: s, endMs: Math.max(s, e) });
  }
  return {
    text: segments.map((s) => s.text).join(" "),
    segments,
    wordLevel: false,
    model: MOCK_ASR_MODEL,
    latencyMs: 5,
    skipped: false,
  };
}

/** Builds schema-valid coaching JSON. Confirms "like" and "you know" candidates. */
export function mockCoachingJson(input: {
  candidates: { id: string; phrase: string }[];
  transcript: string;
  audienceLabel: string;
}): string {
  const confirmed = input.candidates.filter((c) => c.phrase === "like" || c.phrase === "you know").map((c) => c.id);
  const quote = input.transcript.split(/\s+/).slice(0, 8).join(" ");
  const fb: CoachingFeedback = {
    schemaVersion: 1,
    summary: "A clear, personal story with a direct ask at the end. Slow the opening slightly and trim a few hedges.",
    clarity: { score: 78, rationale: "Ideas are concrete and easy to follow, with one or two long sentences." },
    structure: {
      score: 74,
      hasClearOpening: true,
      hasClearClosing: true,
      rationale: "Strong personal hook and an explicit call to action at the end.",
    },
    audienceFit: {
      score: 70,
      rationale: `The story suits a ${input.audienceLabel.toLowerCase()} audience, with a few phrases that could be simpler.`,
      tips: ["Add one question that invites the audience to think about their own habits."],
    },
    pacingInsight: "Your pace was steady overall, slightly quicker in the middle of the talk.",
    fillerReview: { confirmedCandidateIds: confirmed, note: "A few hedges like 'like' slipped in mid-sentence." },
    strengths: [{ title: "Personal story", detail: "Opening with your own experience makes the message believable." }],
    improvements: [
      {
        title: "Pause after your main point",
        detail: "Give the audience a full breath of silence after you state why practice matters.",
        category: "pauses",
        priority: "high",
        evidenceQuote: quote.length > 0 ? quote : null,
        suggestedRewrite: "Practice matters more than talent. (pause) Here's why.",
      },
      {
        title: "Replace hedges with silence",
        detail: "When you feel a 'like' or 'you know' coming, pause silently instead.",
        category: "fillers",
        priority: "medium",
        evidenceQuote: null,
        suggestedRewrite: null,
      },
    ],
    practiceDrill: {
      title: "Pause on purpose",
      instructions: "Re-record the first minute and pause for a full breath after every key claim.",
      durationMinutes: 5,
    },
  };
  return JSON.stringify(fb);
}
