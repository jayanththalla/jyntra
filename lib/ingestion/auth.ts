// Admin gate for ingestion endpoints: a server-side secret (JOB_SYNC_SECRET, or CRON_SECRET as a fallback), compared in
// constant time. Closed when neither is configured. No user session grants admin rights.
import crypto from "node:crypto";

export type AdminAuth = "ok" | "not_configured" | "denied";

export function checkAdmin(req: Request, env = process.env): AdminAuth {
  const secrets = [env.JOB_SYNC_SECRET, env.CRON_SECRET].filter((s): s is string => !!s && s.length >= 16);
  if (!secrets.length) return "not_configured";
  const given = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? req.headers.get("x-admin-secret") ?? "";
  const g = crypto.createHash("sha256").update(given).digest();
  let ok = false;
  for (const s of secrets) ok = crypto.timingSafeEqual(g, crypto.createHash("sha256").update(s).digest()) || ok;
  return ok ? "ok" : "denied";
}
