import type { Improvement, PracticeDrill, StoredFeedback, Strength } from "@/lib/coaching";
import { SCHEMA_VERSION } from "@/lib/coaching";
import type { ResolvedProfile } from "@/lib/audience";

/**
 * Deterministic coaching used when every LLM attempt fails (R8.6, design
 * §4.6). Audience-aware (§6.6). Clarity and structure stay null so the overall
 * score renormalizes.
 */
export interface RulesInput {
  wpm: number;
  fillersPerMin: number;
  longPausesPerMin: number;
  readingGrade: number;
  scores: { pacing: number; fillers: number; pauses: number; readability: number };
  profile: ResolvedProfile;
}

const DRILLS: Record<"pacing" | "fillers" | "pauses" | "audience", PracticeDrill> = {
  pacing: {
    title: "Metronome minute",
    instructions:
      "Set a timer for one minute and read a paragraph aloud, aiming for your target pace. Record it, then compare the WPM on your next report.",
    durationMinutes: 5,
  },
  fillers: {
    title: "Pause instead of filling",
    instructions:
      "Talk about your topic for one minute. Every time you feel an 'um' coming, close your mouth and pause silently instead. Re-record and compare.",
    durationMinutes: 5,
  },
  pauses: {
    title: "Rehearse the transitions",
    instructions:
      "Write the first sentence of each section on a card. Practice moving from card to card without losing your place, then record the full talk again.",
    durationMinutes: 10,
  },
  audience: {
    title: "Rewrite for your audience",
    instructions:
      "Pick your three longest sentences and rewrite each as two shorter ones using everyday words. Say the new versions aloud twice before recording again.",
    durationMinutes: 10,
  },
};

export function buildRulesFeedback(input: RulesInput): StoredFeedback {
  const { profile } = input;
  const improvements: Improvement[] = [];
  const tips: string[] = [];

  if (input.wpm < profile.targetMin || input.wpm > profile.targetMax) {
    const faster = input.wpm < profile.targetMin;
    improvements.push({
      title: faster ? "Pick up the pace a little" : "Slow down your pace",
      detail: `You averaged ${Math.round(input.wpm)} WPM. For a ${profile.profile.label.toLowerCase()} audience, aim for ${profile.targetMin}–${profile.targetMax} WPM.`,
      category: "pacing",
      priority: "high",
      evidenceQuote: null,
      suggestedRewrite: null,
    });
  }
  if (input.fillersPerMin > 3) {
    improvements.push({
      title: "Trim filler words",
      detail: `You used about ${input.fillersPerMin.toFixed(1)} filler words per minute. Replace them with a short silent pause.`,
      category: "fillers",
      priority: "high",
      evidenceQuote: null,
      suggestedRewrite: null,
    });
  }
  if (input.longPausesPerMin > Math.max(1, profile.longPauseTolerance)) {
    improvements.push({
      title: "Smooth out long pauses",
      detail: `You had about ${input.longPausesPerMin.toFixed(1)} long pauses per minute. Rehearse your transitions so you don't lose your place.`,
      category: "pauses",
      priority: "medium",
      evidenceQuote: null,
      suggestedRewrite: null,
    });
  }
  if (input.readingGrade > profile.targetGrade) {
    improvements.push({
      title: "Simplify your language",
      detail: `Your language reads at about grade ${input.readingGrade.toFixed(1)}. For this audience, aim for grade ${profile.targetGrade} or below with shorter sentences and everyday words.`,
      category: "audience",
      priority: "medium",
      evidenceQuote: null,
      suggestedRewrite: null,
    });
    tips.push("Use shorter sentences and everyday words in place of technical terms.");
  }
  if (profile.audience === "young") tips.push("Ask your audience a question to keep them involved.");
  if (profile.audience === "senior") tips.push("Signpost each section and repeat your key point at the end.");
  if (profile.audience === "teen") tips.push("Open with a hook they can relate to in the first 15 seconds.");
  if (tips.length === 0) tips.push("Close with one clear sentence that tells listeners what to remember.");

  if (improvements.length === 0) {
    improvements.push({
      title: "Add a memorable close",
      detail: "Your delivery numbers look solid. Finish with one sentence that tells listeners what to do or remember.",
      category: "structure",
      priority: "low",
      evidenceQuote: null,
      suggestedRewrite: null,
    });
  }

  const ranked = (
    [
      ["pacing", input.scores.pacing],
      ["fillers", input.scores.fillers],
      ["pauses", input.scores.pauses],
      ["audience", input.scores.readability],
    ] as const
  ).slice();
  const best = [...ranked].sort((a, b) => b[1] - a[1])[0] ?? ranked[0];
  const worst = [...ranked].sort((a, b) => a[1] - b[1])[0] ?? ranked[0];
  const strengthText: Record<string, Strength> = {
    pacing: { title: "Comfortable pace", detail: `Your pace of ${Math.round(input.wpm)} WPM is easy to follow.` },
    fillers: { title: "Few filler words", detail: "You kept filler words low, which makes you sound confident." },
    pauses: { title: "Steady flow", detail: "You kept long pauses under control and kept the talk moving." },
    audience: { title: "Clear language", detail: "Your vocabulary suits the audience you chose." },
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    summary:
      "AI coaching wasn't available for this session, so these tips come from your delivery numbers. Retry AI coaching for a fuller review.",
    clarity: null,
    structure: null,
    audienceFit: { score: null, rationale: null, tips: tips.slice(0, 3) },
    pacingInsight: `You averaged ${Math.round(input.wpm)} WPM against a ${profile.targetMin}–${profile.targetMax} WPM target.`,
    fillerReview: null,
    strengths: [strengthText[best[0]] ?? strengthText.pacing!],
    improvements: improvements.slice(0, 5),
    practiceDrill: DRILLS[worst[0]],
  };
}
