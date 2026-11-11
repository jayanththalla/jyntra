import { NextResponse } from "next/server";
import { readJson } from "@/lib/kb/api";
import { fail, sessionId, withUser } from "@/lib/voice/http";
import { voiceDeps } from "@/lib/voice/runtime";
import { ServiceError, speak } from "@/lib/voice/service";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/** POST { idx } → the audio for one interviewer turn of THIS session. On failure the response says fallback:"text" and the UI keeps showing the text. */
export const POST = (req: Request, c: { params: Promise<{ id: string }> }) =>
  withUser(req, "voiceTts", async (user) => {
    const b = await readJson<{ idx?: unknown }>(req, 1_000);
    const idx = Number(b?.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx > 200) return fail(new ServiceError("invalid_request", 400, "Invalid request."));
    const r = await speak(user, sessionId(await c.params), idx, voiceDeps());
    return new NextResponse(Buffer.from(r.audio), { headers: { "Content-Type": r.mime, "Cache-Control": "private, no-store" } });
  });
