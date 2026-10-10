import { assertSameOrigin, json, readJson, toErrorResponse } from "@/server/api";
import { requireUser } from "@/server/auth/identity";
import { createSession } from "@/server/pipeline/create-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/sessions: create a practice session (design §9.1). */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await readJson(req);
    const { sessionId } = await createSession(user.id, body);
    return json({ sessionId, chunkUploadConcurrency: 3 }, 201);
  } catch (err) {
    return toErrorResponse(err, { route: "sessions.create" });
  }
}
