// Route plumbing for /api/voice/*: auth, per-IP and per-account rate limits, and one error shape. Errors never include provider detail.
import { guard, json, toId } from "@/lib/kb/api";
import type { AppUser } from "@/lib/users";
import { ServiceError } from "./service";
import type { LIMITS } from "@/lib/rate-limit";

export { json, toId };

export function fail(e: unknown) {
  if (e instanceof ServiceError) {
    return json({ error: e.code, message: e.message, retryable: e.retryable, ...e.extra }, e.status);
  }
  console.error("[api/voice]", (e as Error)?.name, (e as Error)?.message?.slice(0, 120));
  return json({ error: "server_error", message: "Something went wrong. Please try again.", retryable: true }, 500);
}

export async function withUser(req: Request, limit: keyof typeof LIMITS, fn: (user: AppUser) => Promise<Response>): Promise<Response> {
  const g = await guard(req, limit);
  if ("res" in g) return g.res;
  try {
    return await fn(g.user);
  } catch (e) {
    return fail(e);
  }
}

export function sessionId(params: { id: string }): number {
  const id = toId(params.id);
  if (!id) throw new ServiceError("not_found", 404, "Session not found.");
  return id;
}
