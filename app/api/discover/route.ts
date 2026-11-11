import { NextResponse } from "next/server";
import { query, ready } from "@/lib/database";
import { runStatus, startDiscovery } from "@/lib/discovery/run";
import { maybeAutoRefreshDiscovery } from "@/lib/discovery/auto";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { checkCronAuth } from "@/lib/refresh/auth";

export const dynamic = "force-dynamic";

/**
 * Discovery is shared by all users. A click starts a fresh run unless one finished minutes ago,
 * so many people clicking at once doesn't hammer the sources (a run takes ~3 minutes).
 */
const COOLDOWN_MINUTES = 5;

/** Public view of a run: progress and totals only. The detailed log (sources, URLs) stays server-side. */
function publicStatus() {
  const { running, startedAt, finishedAt, stats, sources } = runStatus();
  return { running, startedAt, finishedAt, stats, sources };
}

export async function GET() {
  // Auto-refresh: the sources are only read when someone asks, so without this the data goes stale between clicks.
  try {
    if (await currentUser()) await maybeAutoRefreshDiscovery();
  } catch (e) {
    console.error("discover: auto-refresh check failed:", e);
  }
  return NextResponse.json(publicStatus());
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "discover");
  if (limited) return limited;
  try {
    await ready();
  } catch (e) {
    console.error("discover: database not ready:", e);
    return NextResponse.json({ error: "The service is temporarily unavailable. Please try again shortly." }, { status: 500 });
  }
  // Allowed for signed-up users, or for a scheduler that knows CRON_SECRET (daily auto-run).
  const cron = checkCronAuth(req) === "ok"; // constant-time; closed if CRON_SECRET is unset
  if (!cron && !(await currentUser())) return NextResponse.json({ error: "no_profile" }, { status: 401 });

  const [last] = await query<{ started_at: Date }>(
    "SELECT started_at FROM discovery_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1"
  );
  if (last && Date.now() - new Date(last.started_at).getTime() < COOLDOWN_MINUTES * 60_000) {
    return NextResponse.json({ started: false, upToDate: true, lastRunAt: last.started_at, ...publicStatus() });
  }
  const started = startDiscovery();
  return NextResponse.json({ started, ...publicStatus() }, { status: started ? 202 : 200 });
}
