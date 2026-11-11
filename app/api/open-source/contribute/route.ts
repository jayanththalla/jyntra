import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { contributionForUser } from "@/lib/open-source/service";
import { listContributions } from "@/lib/open-source/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET  -> the signed-in user's saved and in-progress contributions.
 *  POST { action:"guide"|"ask"|"progress"|"save", repo:"owner/name", number, ... } -> see lib/open-source/service.ts.
 *  Signed-in only. The guide is advice: nothing is ever posted to GitHub. */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read"); if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "no_profile" }, { status: 401 });
  return NextResponse.json({ ok: true, contributions: await listContributions(user.id) });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "interview"); if (limited) return limited; // each guide/answer is a paid AI call
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "no_profile" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 8_192) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const r = await contributionForUser(user, body);
  return NextResponse.json(r.body, { status: r.status });
}
