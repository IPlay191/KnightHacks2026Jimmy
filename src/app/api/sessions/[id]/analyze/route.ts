import { assertSameOrigin, json, parseSessionId, toErrorResponse } from "@/server/api";
import { requireUser } from "@/server/auth/identity";
import { analyzeSession } from "@/server/pipeline/analyze-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const INTERNAL_DEADLINE_MS = 105_000;

/** POST /api/sessions/{id}/analyze: metrics, coaching, and persistence (design §9.3). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const deadline = Date.now() + INTERNAL_DEADLINE_MS;
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const sessionId = parseSessionId(id);
    return json(await analyzeSession(user.id, sessionId, deadline));
  } catch (err) {
    return toErrorResponse(err, { route: "sessions.analyze", sessionId: id });
  }
}
