import "server-only";
import { ERROR_CATALOG, type ErrorCode, type ErrorEnvelope } from "@/lib/errors";

export interface AppErrorOptions {
  message?: string;
  retryAfterSec?: number;
  missingChunks?: number[];
  fieldErrors?: Record<string, string>;
  cause?: unknown;
}

/** A known, catalogued failure. Anything else becomes INTERNAL. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterSec?: number;
  readonly missingChunks?: number[];
  readonly fieldErrors?: Record<string, string>;

  constructor(code: ErrorCode, opts: AppErrorOptions = {}) {
    super(opts.message ?? ERROR_CATALOG[code].message, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CATALOG[code].status;
    this.retryable = ERROR_CATALOG[code].retryable;
    this.retryAfterSec = opts.retryAfterSec;
    this.missingChunks = opts.missingChunks;
    this.fieldErrors = opts.fieldErrors;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.retryAfterSec !== undefined ? { retryAfterSec: this.retryAfterSec } : {}),
        ...(this.missingChunks ? { missingChunks: this.missingChunks } : {}),
        ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
      },
    };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
