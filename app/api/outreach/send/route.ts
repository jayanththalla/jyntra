import { NextResponse } from "next/server";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { sendOutreach } from "@/lib/outreach/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/outreach/send
 *   { startup_id, job_id?, channel: "email"|"linkedin_dm"|"twitter_dm"|"other", delivery?: "smtp"|"manual",
 *     recipient_email?, recipient_name?, subject?, body }
 * - email + smtp (default for email): sent through the user's Gmail. `delivered: true` only if Gmail accepted it.
 * - delivery "manual": the user says they sent it themselves (LinkedIn, Gmail compose window). Recorded as such.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "no_profile" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 20_000) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  // Real emails get the strict limit; logging a message you sent yourself gets the normal write limit.
  const smtp = body?.delivery !== "manual" && (body?.channel ?? "email") === "email";
  const limited = rateLimit(req, smtp ? "send" : "write");
  if (limited) return limited;
  try {
    const r = await sendOutreach(user, body);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("[api/outreach/send]", (e as Error).message);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
