// Authorisation for scheduler / operator endpoints. The secret is compared in constant time and the endpoint is
// CLOSED when CRON_SECRET is not configured (an unset secret must never mean "open to everyone").
import crypto from "node:crypto";

export type CronAuth = "ok" | "not_configured" | "denied";

export function checkCronAuth(req: Request): CronAuth {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return "not_configured";
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const given = bearer ?? req.headers.get("x-cron-secret") ?? "";
  const a = crypto.createHash("sha256").update(given).digest(); // equal length, so timingSafeEqual is safe
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b) ? "ok" : "denied";
}
