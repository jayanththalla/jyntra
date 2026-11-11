import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { checkAdmin } from "./auth";
/** Shared admin gate for ingestion endpoints (Bearer JOB_SYNC_SECRET / CRON_SECRET). null = allowed. */
export function adminGate(req: Request): NextResponse | null {
  const limited = rateLimit(req, "cron");
  if (limited) return limited;
  const a = checkAdmin(req);
  if (a === "not_configured") return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
  if (a === "denied") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
