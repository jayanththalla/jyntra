import { NextResponse } from "next/server";
import { describeSources } from "@/lib/refresh/health";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/sources/status: per-source freshness and health for signed-in users. No credentials or URLs; errors are short messages. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  if (!(await currentUser())) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  try {
    return NextResponse.json(await describeSources());
  } catch (e) {
    console.error("[api/sources/status]", (e as Error).message);
    return NextResponse.json({ error: "status_unavailable" }, { status: 503 });
  }
}
