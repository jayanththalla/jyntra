// Authenticated, ownership-checked creation of a realtime credential for ONE voice session.
import type { AppUser } from "@/lib/users";
import { getSession, ServiceError, type VoiceDeps } from "./service";
import { RealtimeError, realtimeInstructions, realtimeConfig, type RealtimeProvider } from "./realtime";

export async function createRealtimeCredential(user: AppUser, sessionId: number, provider: RealtimeProvider | null, d: VoiceDeps) {
  const v = await getSession(user, sessionId, d);                                  // 404 for anyone else's session: ownership enforced by user_id in SQL
  if (v.session.status !== "active") throw new ServiceError("session_finished", 409, "This interview has ended.");
  if (v.remaining.seconds <= 0) throw new ServiceError("session_expired", 409, "This session's time is up.");
  if (!provider) throw new ServiceError("not_configured", 503, realtimeConfig().reason ?? "Realtime voice is not configured.");
  try {
    const c = await provider.createCredential({ userId: user.id, sessionId, instructions: realtimeInstructions({ role: v.session.role, mode: v.session.mode }) });
    // Never more than the session has left; the browser refetches when it needs another.
    return { provider: c.provider, value: c.value, expiresAt: c.expiresAt, model: c.model, connectUrl: c.connectUrl, transport: c.transport };
  } catch (e) {
    if (e instanceof RealtimeError) {
      const status = e.code === "rate_limited" ? 429 : e.code === "not_configured" ? 503 : e.code === "auth" ? 503 : 502;
      throw new ServiceError(e.code, status, e.message, e.retryable);
    }
    throw e;
  }
}
