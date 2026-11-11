import { fail, json, sessionId, withUser } from "@/lib/voice/http";
import { voiceDeps } from "@/lib/voice/runtime";
import { ServiceError, transcribe } from "@/lib/voice/service";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * POST multipart: audio (file), duration_ms (optional, the browser's claim) → { transcript } for REVIEW.
 * Nothing is stored and nothing reaches the interviewer here. The size is checked before the body is read.
 */
export const POST = (req: Request, c: { params: Promise<{ id: string }> }) =>
  withUser(req, "voiceStt", async (user) => {
    const d = voiceDeps();
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > d.limits.maxAudioBytes + 4_096) return fail(new ServiceError("invalid_audio", 413, "That recording is too large. Record a shorter answer.", false, { problem: "too_large" }));
    let form: FormData;
    try { form = await req.formData(); } catch { return fail(new ServiceError("invalid_request", 400, "Invalid upload.")); }
    const file = form.get("audio");
    if (!(file instanceof File)) return fail(new ServiceError("invalid_audio", 400, "No audio was received.", false, { problem: "empty" }));
    const ms = Number(form.get("duration_ms"));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const t = await transcribe(user, sessionId(await c.params), bytes, file.type, Number.isFinite(ms) && ms > 0 ? ms / 1000 : null, d);
    return json({ transcript: t });
  });
