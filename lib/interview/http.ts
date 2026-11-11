import { guard, json, readJson } from "@/lib/kb/api";
import type { AppUser } from "@/lib/users";
import type { LIMITS } from "@/lib/rate-limit";
import type { Result } from "./service-v2";

export { json };
/** Auth + per-IP and per-account rate limit + JSON body (size capped) + one error shape. No provider detail ever reaches the client. */
export async function post(req: Request, limit: keyof typeof LIMITS, fn: (user: AppUser, body: Record<string, unknown>) => Promise<Result> | Result, maxBytes = 60_000): Promise<Response> {
  const g = await guard(req, limit);
  if ("res" in g) return g.res;
  const body = await readJson(req, maxBytes);
  if (!body) return json({ ok: false, error: "invalid_request" }, 400);
  try { const r = await fn(g.user, body); return json(r.body, r.status); }
  catch (e) { console.error("[api/interview]", (e as Error).name, (e as Error).message?.slice(0, 120)); return json({ ok: false, error: "server_error", message: "Something went wrong. Please try again.", retryable: true }, 500); }
}
export { guard };
