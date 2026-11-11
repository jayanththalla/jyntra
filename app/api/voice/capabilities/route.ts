import { json, withUser } from "@/lib/voice/http";
import { voiceDeps } from "@/lib/voice/runtime";
import { realtimeConfig } from "@/lib/voice/realtime";

export const dynamic = "force-dynamic";

/** GET /api/voice/capabilities → which parts of the voice interview are configured on this server (no keys, no values). */
export const GET = (req: Request) => withUser(req, "read", async () => { const r = realtimeConfig(); return json({ capabilities: voiceDeps().caps, realtime: { configured: r.configured, provider: r.provider, model: r.configured ? r.model : null, reason: r.reason } }); });
