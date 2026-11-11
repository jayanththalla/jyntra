import { json, sessionId, withUser } from "@/lib/voice/http";
import { voiceDeps } from "@/lib/voice/runtime";
import { realtimeProvider } from "@/lib/voice/realtime";
import { createRealtimeCredential } from "@/lib/voice/realtime-service";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** POST → a short-lived (about 2 minutes) realtime credential for THIS session. The permanent API key never leaves the server. */
export const POST = (req: Request, c: { params: Promise<{ id: string }> }) =>
  withUser(req, "voiceRealtime", async (user) => {
    const cred = await createRealtimeCredential(user, sessionId(await c.params), realtimeProvider(), voiceDeps());
    const res = json(cred);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  });
