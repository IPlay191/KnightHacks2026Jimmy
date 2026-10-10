/**
 * Studio recording state machine (design §10.4, R2, R4). Pure: invalid
 * events for the current state return the same state (P10).
 */
export const MIN_RECORDING_MS = 10_000;
export const WARNING_MS = 270_000;
export const MAX_RECORDING_MS = 300_000;

export type DeniedReason = "not-allowed" | "not-found-mic" | "not-found-camera" | "not-readable" | "overconstrained";
export type UnsupportedReason = "insecure" | "no-media" | "no-worklet";

export type StudioState =
  | { kind: "checking" }
  | { kind: "unsupported"; reason: UnsupportedReason }
  | { kind: "explainer" }
  | { kind: "acquiring"; audioOnly: boolean }
  | { kind: "denied"; reason: DeniedReason; canUseMicOnly: boolean }
  | { kind: "ready"; audioOnly: boolean }
  | { kind: "countdown"; remaining: 3 | 2 | 1; audioOnly: boolean }
  | { kind: "recording"; startedAt: number; accumulatedMs: number; audioOnly: boolean }
  | { kind: "paused"; accumulatedMs: number; audioOnly: boolean }
  | { kind: "interrupted"; capturedMs: number; audioOnly: boolean }
  | { kind: "finalizing"; audioOnly: boolean }
  | { kind: "tooShort"; capturedMs: number; audioOnly: boolean }
  | { kind: "submitting"; audioOnly: boolean }
  | { kind: "submitError"; code: string; message: string; retryable: boolean; audioOnly: boolean }
  | { kind: "submitted"; sessionId: string };

export type StudioEvent =
  | { type: "SUPPORT_FAIL"; reason: UnsupportedReason }
  | { type: "PERMISSION_UNKNOWN" }
  | { type: "PERMISSION_GRANTED" }
  | { type: "ENABLE" }
  | { type: "ACQUIRED"; audioOnly: boolean }
  | { type: "ACQUIRE_FAILED"; reason: DeniedReason; canUseMicOnly: boolean }
  | { type: "RETRY" }
  | { type: "MIC_ONLY" }
  | { type: "DEVICE_CHANGED" }
  | { type: "START" }
  | { type: "TICK" }
  | { type: "CANCEL" }
  | { type: "PAUSE"; now: number }
  | { type: "RESUME"; now: number }
  | { type: "STOP" }
  | { type: "DISCARD" }
  | { type: "TRACK_ENDED"; capturedMs: number }
  | { type: "ANALYZE_PARTIAL" }
  | { type: "FINALIZED"; capturedMs: number }
  | { type: "RECORD_AGAIN" }
  | { type: "SUBMIT_OK"; sessionId: string }
  | { type: "SUBMIT_FAILED"; code: string; message: string; retryable: boolean }
  | { type: "RETRY_SUBMIT" }
  | { type: "BEGIN_RECORDING"; now: number };

const audioOnlyOf = (s: StudioState): boolean => ("audioOnly" in s ? s.audioOnly : false);

export function transition(state: StudioState, event: StudioEvent): StudioState {
  switch (state.kind) {
    case "checking":
      if (event.type === "SUPPORT_FAIL") return { kind: "unsupported", reason: event.reason };
      if (event.type === "PERMISSION_UNKNOWN") return { kind: "explainer" };
      if (event.type === "PERMISSION_GRANTED") return { kind: "acquiring", audioOnly: false };
      return state;
    case "unsupported":
      return state;
    case "explainer":
      if (event.type === "ENABLE") return { kind: "acquiring", audioOnly: false };
      return state;
    case "acquiring":
      if (event.type === "ACQUIRED") return { kind: "ready", audioOnly: event.audioOnly };
      if (event.type === "ACQUIRE_FAILED") {
        return { kind: "denied", reason: event.reason, canUseMicOnly: event.canUseMicOnly };
      }
      return state;
    case "denied":
      if (event.type === "RETRY") return { kind: "acquiring", audioOnly: false };
      if (event.type === "MIC_ONLY" && state.canUseMicOnly) return { kind: "acquiring", audioOnly: true };
      return state;
    case "ready":
      if (event.type === "START") return { kind: "countdown", remaining: 3, audioOnly: state.audioOnly };
      if (event.type === "DEVICE_CHANGED") return { kind: "acquiring", audioOnly: state.audioOnly };
      if (event.type === "ACQUIRE_FAILED") {
        return { kind: "denied", reason: event.reason, canUseMicOnly: event.canUseMicOnly };
      }
      return state;
    case "countdown":
      if (event.type === "CANCEL") return { kind: "ready", audioOnly: state.audioOnly };
      if (event.type === "TICK") {
        if (state.remaining === 1) return state; // BEGIN_RECORDING follows once capture has started
        return { ...state, remaining: (state.remaining - 1) as 2 | 1 };
      }
      if (event.type === "BEGIN_RECORDING" && state.remaining === 1) {
        return { kind: "recording", startedAt: event.now, accumulatedMs: 0, audioOnly: state.audioOnly };
      }
      return state;
    case "recording":
      if (event.type === "PAUSE") {
        return {
          kind: "paused",
          accumulatedMs: state.accumulatedMs + Math.max(0, event.now - state.startedAt),
          audioOnly: state.audioOnly,
        };
      }
      if (event.type === "STOP") return { kind: "finalizing", audioOnly: state.audioOnly };
      if (event.type === "DISCARD") return { kind: "ready", audioOnly: state.audioOnly };
      if (event.type === "TRACK_ENDED") {
        return { kind: "interrupted", capturedMs: event.capturedMs, audioOnly: state.audioOnly };
      }
      return state;
    case "paused":
      if (event.type === "RESUME") {
        return { kind: "recording", startedAt: event.now, accumulatedMs: state.accumulatedMs, audioOnly: state.audioOnly };
      }
      if (event.type === "STOP") return { kind: "finalizing", audioOnly: state.audioOnly };
      if (event.type === "DISCARD") return { kind: "ready", audioOnly: state.audioOnly };
      if (event.type === "TRACK_ENDED") {
        return { kind: "interrupted", capturedMs: event.capturedMs, audioOnly: state.audioOnly };
      }
      return state;
    case "interrupted":
      if (event.type === "ANALYZE_PARTIAL" && state.capturedMs >= MIN_RECORDING_MS) {
        return { kind: "finalizing", audioOnly: state.audioOnly };
      }
      if (event.type === "RECORD_AGAIN") return { kind: "acquiring", audioOnly: state.audioOnly };
      return state;
    case "finalizing":
      if (event.type === "FINALIZED") {
        return event.capturedMs < MIN_RECORDING_MS
          ? { kind: "tooShort", capturedMs: event.capturedMs, audioOnly: state.audioOnly }
          : { kind: "submitting", audioOnly: state.audioOnly };
      }
      if (event.type === "SUBMIT_FAILED") {
        return { kind: "submitError", code: event.code, message: event.message, retryable: event.retryable, audioOnly: state.audioOnly };
      }
      return state;
    case "tooShort":
      if (event.type === "RECORD_AGAIN") return { kind: "acquiring", audioOnly: state.audioOnly };
      return state;
    case "submitting":
      if (event.type === "SUBMIT_OK") return { kind: "submitted", sessionId: event.sessionId };
      if (event.type === "SUBMIT_FAILED") {
        return { kind: "submitError", code: event.code, message: event.message, retryable: event.retryable, audioOnly: state.audioOnly };
      }
      return state;
    case "submitError":
      if (event.type === "RETRY_SUBMIT" && state.retryable) return { kind: "submitting", audioOnly: state.audioOnly };
      if (event.type === "RECORD_AGAIN") return { kind: "acquiring", audioOnly: state.audioOnly };
      return state;
    case "submitted":
      return state;
  }
}

/** Elapsed captured time for recording/paused states (paused time excluded). */
export function elapsedMs(state: StudioState, now: number): number {
  if (state.kind === "recording") return state.accumulatedMs + Math.max(0, now - state.startedAt);
  if (state.kind === "paused") return state.accumulatedMs;
  return 0;
}

export function isLive(state: StudioState): boolean {
  return state.kind === "recording" || state.kind === "paused";
}

export { audioOnlyOf };
