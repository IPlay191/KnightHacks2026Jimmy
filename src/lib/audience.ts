import type { Audience } from "./types";

/**
 * Audience profiles (design §6.6, R20.3). Starting heuristics, versioned so
 * they can be tuned. Pure data shared by server scoring and UI labels.
 */
export const AUDIENCE_PROFILE_VERSION = 1;

export interface AudienceProfile {
  id: Audience;
  label: string;
  ageRange: string;
  /** One line shown in the picker (R20.1). */
  description: string;
  /** null means "use the user's General target from settings". */
  wpm: { min: number; max: number } | null;
  targetGrade: number;
  longPauseTolerancePerMin: number;
  coachingFocus: string[];
}

export const AUDIENCE_PROFILES: Record<Audience, AudienceProfile> = {
  general: {
    id: "general",
    label: "General",
    ageRange: "Adults",
    description: "No special adjustment. Uses your own pace target from settings.",
    wpm: null,
    targetGrade: 10,
    longPauseTolerancePerMin: 0.5,
    coachingFocus: ["Clarity of ideas", "Logical structure", "Confident delivery"],
  },
  young: {
    id: "young",
    label: "Young",
    ageRange: "Ages 6–12",
    description: "Slower pace, simpler words, more pauses, and lots of examples.",
    wpm: { min: 110, max: 140 },
    targetGrade: 5,
    longPauseTolerancePerMin: 1.0,
    coachingFocus: [
      "Short sentences",
      "Concrete examples and stories",
      "Questions that invite participation",
      "Energy and warmth",
      "No jargon or abstract ideas without an example",
    ],
  },
  teen: {
    id: "teen",
    label: "Teen",
    ageRange: "Ages 13–17",
    description: "Natural pace, relatable examples, a strong hook, no talking down.",
    wpm: { min: 130, max: 160 },
    targetGrade: 8,
    longPauseTolerancePerMin: 0.5,
    coachingFocus: [
      "Relevance to their lives",
      "Relatable examples",
      "A strong hook in the first 15 seconds",
      "Authentic tone without talking down",
      "No dated slang",
    ],
  },
  senior: {
    id: "senior",
    label: "Senior",
    ageRange: "Ages 65+",
    description: "Steady pace, clear signposting, repeated key points, no jargon.",
    wpm: { min: 115, max: 145 },
    targetGrade: 9,
    longPauseTolerancePerMin: 1.0,
    coachingFocus: [
      "Steady pace and clear articulation",
      "Signposting (first, next, finally)",
      "Repeating key points",
      "Respectful tone",
      "Avoiding slang, acronyms, and tech jargon",
    ],
  },
};

export interface ResolvedProfile {
  audience: Audience;
  version: number;
  targetMin: number;
  targetMax: number;
  targetGrade: number;
  longPauseTolerance: number;
  profile: AudienceProfile;
}

/** Pure and total over the 4 audiences (P15). Only `general` reads the user's target. */
export function resolveAudienceProfile(
  audience: Audience,
  settings: { targetWpmMin: number; targetWpmMax: number },
): ResolvedProfile {
  const profile = AUDIENCE_PROFILES[audience] ?? AUDIENCE_PROFILES.general;
  const wpm = profile.wpm ?? { min: settings.targetWpmMin, max: settings.targetWpmMax };
  return {
    audience: profile.id,
    version: AUDIENCE_PROFILE_VERSION,
    targetMin: wpm.min,
    targetMax: wpm.max,
    targetGrade: profile.targetGrade,
    longPauseTolerance: profile.longPauseTolerancePerMin,
    profile,
  };
}

export function audienceLabel(audience: Audience): string {
  return AUDIENCE_PROFILES[audience]?.label ?? "General";
}
