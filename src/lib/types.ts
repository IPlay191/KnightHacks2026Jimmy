/** Domain types shared by server and client. Pure data, no secrets. */

export const AUDIENCES = ["general", "young", "teen", "senior"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const MOTION_PREFS = ["system", "reduce", "full"] as const;
export type MotionPreference = (typeof MOTION_PREFS)[number];

export type SessionStatus = "created" | "uploading" | "transcribed" | "analyzing" | "complete" | "failed";
export type PipelineStage = "transcribing" | "metrics" | "coaching" | "saving";
export type ChunkStatus = "pending" | "transcribing" | "done" | "failed";
export type TimingSource = "asr_word" | "asr_segment" | "interpolated";
export type FillerStatus = "unambiguous" | "confirmed" | "rejected" | "unreviewed";
export type FeedbackSource = "llm" | "rules";
export type AudienceFitSource = "combined" | "readability_only";

/** A half-open time interval on the session timeline, in milliseconds. */
export interface Interval {
  startMs: number;
  endMs: number;
}

export interface TimedText extends Interval {
  text: string;
}

export interface TimelineWindow extends Interval {
  wpm: number;
  words: number;
}

export type FillerBreakdown = Record<string, { count: number; confirmed: boolean }>;

export interface VisualMetrics {
  eyeContactPct: number;
  headStability: number;
}
