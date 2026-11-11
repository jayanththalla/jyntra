import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { generateForUser } from "@/lib/ai/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai/generate-outreach   { startup_id, job_id?, style, recipient_name? }
 * Signed-in users only, rate limited (each call costs money upstream). The company and profile facts are loaded
 * from the database, never taken from the request. Keys stay on the server.
 * Responses: 200 {generated:true,…} | 200 {generated:false, code:"not_configured"} | 4xx/5xx {generated:false, code, message, retryable}
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "ai");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ generated: false, error: "no_profile" }, { status: 401 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 4096) return NextResponse.json({ generated: false, error: "payload_too_large" }, { status: 413 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ generated: false, error: "invalid_json" }, { status: 400 });
  }
  try {
    const r = await generateForUser(user, body);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("[api/ai/generate-outreach]", (e as Error).message);
    return NextResponse.json({ generated: false, error: "server_error" }, { status: 500 });
  }
}
