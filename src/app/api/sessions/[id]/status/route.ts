import { isErrorCode, messageFor, ERROR_CATALOG } from "@/lib/errors";
import { AppError } from "@/server/errors";
import { json, parseSessionId, toErrorResponse } from "@/server/api";
import { requireUser } from "@/server/auth/identity";
import { getStatusView } from "@/server/db/queries/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sessions/{id}/status: progress polling (design §9.4, R9.4). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const user = await requireUser();
    const sessionId = parseSessionId(id);
    const view = await getStatusView(user.id, sessionId);
    if (!view) throw new AppError("NOT_FOUND");
    const code = view.errorCode;
    const error =
      view.status === "failed" && code
        ? isErrorCode(code)
          ? {
              code,
              message: messageFor(code),
              retryable: ERROR_CATALOG[code].retryable && view.analysisAttempts < 3,
            }
          : { code: "INTERNAL", message: messageFor("INTERNAL"), retryable: view.analysisAttempts < 3 }
        : null;
    return json({
      status: view.status,
      stage: view.stage,
      chunksDone: view.chunksDone,
      chunksExpected: view.chunksExpected,
      missingChunks: view.missingChunks,
      failedStage: view.failedStage,
      error,
      updatedAt: view.updatedAt.toISOString(),
    });
  } catch (err) {
    return toErrorResponse(err, { route: "sessions.status" });
  }
}
