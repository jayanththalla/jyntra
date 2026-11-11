import { readJson } from "@/lib/kb/api";
import { json, withUser, fail } from "@/lib/voice/http";
import { voiceDeps } from "@/lib/voice/runtime";
import { createSession, listSessions, purgeExpiredRecordings, ServiceError } from "@/lib/voice/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET → the caller's sessions (also removes expired recordings). */
export const GET = (req: Request) =>
  withUser(req, "read", async (user) => {
    await purgeExpiredRecordings().catch(() => 0);
    return json({ sessions: await listSessions(user.id) });
  });

/** POST { mode, difficulty?, role?, topics?, seed_instruction?, job_description?, input_mode?: "voice"|"text", retain_audio?, consent_audio? } → session with the first question. */
export const POST = (req: Request) =>
  withUser(req, "voiceSession", async (user) => {
    const b = await readJson<Record<string, unknown>>(req, 20_000);
    if (!b) return fail(new ServiceError("invalid_request", 400, "Invalid request."));
    return json(await createSession(user, b as never, voiceDeps()), 201);
  });
