/**
 * Error catalog shared by the server (status, log level) and the client
 * (user-facing message, retryability). Design §9.9, R17.1–17.2.
 */
export const ERROR_CATALOG = {
  VALIDATION_FAILED: { status: 400, retryable: false, level: "info", message: "Something about this request wasn't valid." },
  UNAUTHENTICATED: { status: 401, retryable: false, level: "info", message: "Please continue as a guest to keep going." },
  FORBIDDEN_ORIGIN: { status: 403, retryable: false, level: "warn", message: "This request isn't allowed." },
  NOT_FOUND: { status: 404, retryable: false, level: "info", message: "We couldn't find that session." },
  CONFLICT_STATE: { status: 409, retryable: false, level: "info", message: "This session has already been processed." },
  CHUNKS_INCOMPLETE: { status: 409, retryable: true, level: "info", message: "Some parts of the recording haven't finished uploading." },
  ANALYSIS_IN_PROGRESS: { status: 409, retryable: true, level: "info", message: "Your speech is still being analyzed." },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false, level: "warn", message: "That recording piece was too large." },
  UNSUPPORTED_AUDIO: { status: 415, retryable: false, level: "error", message: "We couldn't read that audio. Please record again." },
  NO_SPEECH_DETECTED: { status: 422, retryable: false, level: "info", message: "We couldn't hear enough speech. Try again closer to the mic." },
  RATE_LIMITED: { status: 429, retryable: false, level: "warn", message: "You've hit today's practice limit. Try again later." },
  ANALYSIS_LIMIT: { status: 429, retryable: false, level: "warn", message: "Analysis failed several times. Please record again." },
  UPSTREAM_BUSY: { status: 503, retryable: true, level: "warn", message: "The AI service is busy or warming up. Retrying usually works." },
  UPSTREAM_TIMEOUT: { status: 504, retryable: true, level: "warn", message: "The AI service took too long. Retry?" },
  UPSTREAM_FAILED: { status: 502, retryable: true, level: "error", message: "The AI service returned an error. Retry?" },
  UPSTREAM_CONFIG: { status: 500, retryable: false, level: "error", message: "The AI service isn't configured correctly." },
  SERVICE_UNAVAILABLE: { status: 503, retryable: true, level: "error", message: "We couldn't save your session. Retry." },
  INTERNAL: { status: 500, retryable: true, level: "error", message: "Something went wrong on our side. Retry." },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;

/** Wire format of every API error (R17.1). */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    retryAfterSec?: number;
    missingChunks?: number[];
    fieldErrors?: Record<string, string>;
  };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in ERROR_CATALOG;
}

export function messageFor(code: ErrorCode): string {
  return ERROR_CATALOG[code].message;
}
