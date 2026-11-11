// GET /api/yc-jobs — Y Combinator companies (funded in the last 3 months or in the current batch)
// with their recent jobs, scored for the current user. Includes founders, so the page can show
// their LinkedIn profiles as listed on YC.
import { NextResponse } from "next/server";
import { loadStartups } from "@/lib/discovery/read";
import { query } from "@/lib/database";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { isYcStartup } from "@/lib/filters";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
    const [all, [lastRun]] = await Promise.all([
      loadStartups(user), // full view: founders are left out of the slim dashboard list
      query("SELECT started_at FROM discovery_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1"),
    ]);
    // Keep the response small: drop fields this page doesn't show.
    const startups = all.filter(isYcStartup).map((s) => ({
      ...s,
      description: s.description && s.description.length > 300 ? s.description.slice(0, 297) + "…" : s.description,
      field_sources: {},
      funding_reports: [],
      classification_reasons: [],
      jobs: s.jobs.map((j) => ({ ...j, skills: [] })),
    }));
    return NextResponse.json({ startups, lastRunAt: lastRun?.started_at ?? null, profile: user.profile });
  } catch (e) {
    console.error("yc-jobs:", e);
    return NextResponse.json({ error: "Couldn't load YC jobs. Please try again in a moment." }, { status: 500 });
  }
}
