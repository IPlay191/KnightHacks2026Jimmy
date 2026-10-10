import "server-only";

type Level = "debug" | "info" | "warn" | "error";

/**
 * Allowed structured fields. Transcript text, audio, tokens, and raw IPs are
 * intentionally not representable here (R17.4).
 */
export interface LogFields {
  sessionId?: string;
  userIdHash?: string;
  stage?: string;
  model?: string;
  attempt?: number;
  status?: number;
  latencyMs?: number;
  code?: string;
  failure?: string;
  chunkIndex?: number;
  detail?: string;
  stack?: string;
}

function write(level: Level, event: string, fields: LogFields = {}): void {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
