import { AppError } from "@/server/errors";
import { assertSameOrigin, json, parseSessionId, toErrorResponse } from "@/server/api";
import { requireUser } from "@/server/auth/identity";
import { MAX_CHUNK_BYTES, processChunk } from "@/server/pipeline/process-chunk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const INTERNAL_DEADLINE_MS = 50_000;

function intParam(value: string | null): number {
  if (value === null || !/^\d{1,7}$/.test(value)) return Number.NaN;
  return Number(value);
}

/** PUT /api/sessions/{id}/chunks/{index}?startMs&endMs: upload and transcribe (design §9.2). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await ctx.params;
  const deadline = Date.now() + INTERNAL_DEADLINE_MS;
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const sessionId = parseSessionId(id);
    const idx = intParam(index);
    const url = new URL(req.url);
    const startMs = intParam(url.searchParams.get("startMs"));
    const endMs = intParam(url.searchParams.get("endMs"));
    if (!Number.isInteger(idx) || !Number.isInteger(startMs) || !Number.isInteger(endMs)) {
      throw new AppError("VALIDATION_FAILED", { message: "Chunk index and offsets must be whole numbers." });
    }
    // Check the declared size before reading the body, then the actual size.
    const declared = req.headers.get("content-length");
    if (declared !== null && Number(declared) > MAX_CHUNK_BYTES) throw new AppError("PAYLOAD_TOO_LARGE");
    const body = new Uint8Array(await req.arrayBuffer());
    if (body.length > MAX_CHUNK_BYTES) throw new AppError("PAYLOAD_TOO_LARGE");
    const result = await processChunk({
      userId: user.id,
      sessionId,
      index: idx,
      startMs,
      endMs,
      contentType: req.headers.get("content-type"),
      body,
      deadline,
    });
    return json(result);
  } catch (err) {
    return toErrorResponse(err, { route: "sessions.chunk", sessionId: id });
  }
}
