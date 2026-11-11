import { NextResponse } from "next/server";
import { freshWindowStart, loadStartups } from "@/lib/discovery/read";
import { query } from "@/lib/database";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
    const [startups, [lastRun], freshSince] = await Promise.all([
      loadStartups(user, { slim: true }),
      query("SELECT id, started_at, finished_at, status FROM discovery_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1"),
      freshWindowStart(),
    ]);
    return NextResponse.json({ startups, lastRun: lastRun ?? null, freshSince: freshSince.toISOString(), profile: user.profile });
  } catch (e) {
    console.error("[api/startups]", (e as Error).message); // server log only
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
