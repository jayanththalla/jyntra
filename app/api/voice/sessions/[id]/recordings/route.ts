import { fail, json, sessionId, withUser } from "@/lib/voice/http";
import { voiceDeps } from "@/lib/voice/runtime";
import { deleteRecordings, saveRecording, ServiceError } from "@/lib/voice/service";

export const dynamic = "force-dynamic";

/** POST multipart: audio, turn_idx → keeps the recording of an ACCEPTED answer. Only for sessions started with consent; expires automatically. */
export const POST = (req: Request, c: { params: Promise<{ id: string }> }) =>
  withUser(req, "voiceStt", async (user) => {
    const d = voiceDeps();
    if (Number(req.headers.get("content-length") ?? 0) > d.limits.maxAudioBytes + 4_096) return fail(new ServiceError("invalid_audio", 413, "That recording is too large.", false, { problem: "too_large" }));
    let form: FormData;
    try { form = await req.formData(); } catch { return fail(new ServiceError("invalid_request", 400, "Invalid upload.")); }
    const file = form.get("audio");
    const idx = Number(form.get("turn_idx"));
    if (!(file instanceof File) || !Number.isInteger(idx)) return fail(new ServiceError("invalid_request", 400, "Invalid upload."));
    return json(await saveRecording(user, sessionId(await c.params), idx, new Uint8Array(await file.arrayBuffer()), file.type, d), 201);
  });

/** DELETE → removes every stored recording of the session now. */
export const DELETE = (req: Request, c: { params: Promise<{ id: string }> }) => withUser(req, "write", async (user) => json({ deleted: await deleteRecordings(user.id, sessionId(await c.params)) }));
