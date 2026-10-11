import type { Improvement, StoredFeedback, Strength } from "@/lib/coaching";
import { SCHEMA_VERSION } from "@/lib/coaching";
import type { ResolvedProfile } from "@/lib/audience";

/**
 * Deterministic coaching used when every LLM attempt fails (R8.6, design
 * §4.6). Audience-aware (§6.6). Clarity and structure stay null, and the
 * overall score is capped as delivery-only (design §6.5).
 */
export interface RulesInput {
  wpm: number;
  fillersPerMin: number;
  longPausesPerMin: number;
  readingGrade: number;
  scores: { pacing: number; fillers: number; pauses: number; readability: number };
  profile: ResolvedProfile;
  /** Failure class from the coaching step, for the report notice. */
  reason: string | null;
}

/** Plain-language explanation for why AI coaching was unavailable. */
export function describeUnavailable(reason: string | null): string {
  const r = reason ?? "";
  if (r.startsWith("quota")) return "The Hugging Face account has no remaining credits.";
  if (r.startsWith("config")) {
    return "The AI model refused the request. The Hugging Face token may lack permission, or the model's license hasn't been accepted.";
  }
  if (r.includes("timeout") || r === "deadline") return "The AI model took too long to respond.";
  if (r === "schema" || r === "json_parse") return "The AI model's reply couldn't be understood.";
  if (r === "not_found") return "The configured AI model isn't available from Hugging Face right now.";
  if (r === "mock_fail") return "AI coaching was turned off for this test session.";
  return "The AI service was busy or unavailable.";
}

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
  if (input.fillersPerMin > 2) {
    improvements.push({
      title: "Trim filler words",
      detail: `You used about ${input.fillersPerMin.toFixed(1)} filler words per minute. Replace them with a short silent pause.`,
      category: "fillers",
      priority: "high",
      evidenceQuote: null,
      suggestedRewrite: null,
    });
  }
  if (input.longPausesPerMin > profile.longPauseTolerance) {
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

  improvements.push({
    title: "Get your content reviewed",
    detail:
      "Delivery numbers can't tell whether your message is clear or well organized. Retry AI coaching to get a review of your actual content.",
    category: "clarity",
    priority: improvements.length ? "low" : "high",
    evidenceQuote: null,
    suggestedRewrite: null,
  });

  const ranked = [
    ["pacing", input.scores.pacing],
    ["fillers", input.scores.fillers],
    ["pauses", input.scores.pauses],
    ["audience", input.scores.readability],
  ] as const;
  const best = [...ranked].sort((a, b) => b[1] - a[1])[0] ?? ranked[0];
  const strengthText: Record<string, Strength> = {
    pacing: { title: "Comfortable pace", detail: `Your pace of ${Math.round(input.wpm)} WPM is easy to follow.` },
    fillers: { title: "Few filler words", detail: "You kept filler words low, which makes you sound confident." },
    pauses: { title: "Steady flow", detail: "You kept long pauses under control and kept the talk moving." },
    audience: { title: "Plain language", detail: "Your vocabulary level suits the audience you chose." },
  };
  const reasonText = describeUnavailable(input.reason);

  return {
    schemaVersion: SCHEMA_VERSION,
    contentVerdict: null,
    mainMessage: null,
    summary: `AI coaching wasn't available for this session (${reasonText.replace(/\.$/, "").toLowerCase()}), so these tips come from your delivery numbers only. Retry AI coaching for a full review of your content.`,
    clarity: null,
    structure: null,
    audienceFit: { score: null, rationale: null, tips: tips.slice(0, 3) },
    pacingInsight: `You averaged ${Math.round(input.wpm)} WPM against a ${profile.targetMin}–${profile.targetMax} WPM target.`,
    fillerReview: null,
    strengths: [strengthText[best[0]] ?? strengthText.pacing!],
    improvements: improvements.slice(0, 5),
    unavailableReason: reasonText,
  };
}
