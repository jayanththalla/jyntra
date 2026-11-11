import { json, sessionId, withUser } from "@/lib/voice/http";
import { voiceDeps } from "@/lib/voice/runtime";
import { endSession } from "@/lib/voice/service";

export const dynamic = "force-dynamic";
export const maxDuration = 80;

/** POST → ends the session and returns the evaluation (computed from the accepted transcript only). */
export const POST = (req: Request, c: { params: Promise<{ id: string }> }) => withUser(req, "voiceTurn", async (user) => json(await endSession(user, sessionId(await c.params), voiceDeps())));
