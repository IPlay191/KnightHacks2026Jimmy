import { AppError } from "@/server/errors";
import { assertSameOrigin, noContent, parseSessionId, toErrorResponse } from "@/server/api";
import { requireUser } from "@/server/auth/identity";
import { deleteSession } from "@/server/db/queries/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/sessions/{id}: delete one session and recompute stats (design §9.6). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const sessionId = parseSessionId(id);
    const deleted = await deleteSession(user.id, sessionId);
    if (!deleted) throw new AppError("NOT_FOUND");
    return noContent();
  } catch (err) {
    return toErrorResponse(err, { route: "sessions.delete" });
  }
}
