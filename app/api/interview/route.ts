import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { interviewForUser } from "@/lib/interview/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/interview
 *   { action:"start",    type, level, startup_id?, count? }              -> { ok, questions:[{id,text,focus}] }
 *   { action:"feedback", type, level, startup_id?, question, answer }    -> { ok, feedback:{score,verdict,strengths,improvements,structure,followUp} }
 * Signed-in users only and rate limited (each call is paid upstream). The profile and company facts come from the
 * database, never from the request. Keys stay on the server.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "interview");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "no_profile" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 16_384) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  try {
    const r = await interviewForUser(user, body);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("[api/interview]", (e as Error).message);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
