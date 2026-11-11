import { NextResponse } from "next/server";
import { query, ready } from "@/lib/database";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { runStatus } from "@/lib/discovery/run";
import { maybeAutoRefreshDiscovery } from "@/lib/discovery/auto";
import { maybeRefreshNewsInBackground, newsRefreshing } from "@/lib/news/refresh";
import { disabledByConfig } from "@/lib/providers/config";
import { settings } from "@/config/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/live — the heartbeat every open page polls.
 *  1. Starts a background refresh when jobs/startups or funding news are stale (so opening the app updates it).
 *  2. Returns a `version` that changes whenever a refresh finishes; pages reload their data when it changes.
 * It reads two small rows and never waits for a refresh, so it is cheap to poll.
 */
export async function GET(req: Request) {
  const limited = rateLimit(req, "live");
  if (limited) return limited;
  try {
    await ready();
    let user = null;
    try {
      user = await currentUser();
    } catch {
      // not signed in: news still refreshes, jobs/startups need a profile
    }
    const [[done], [lastRun], [rss], [att]] = await Promise.all([
      query<{ id: number; finished_at: Date | null; started_at: Date }>("SELECT id, started_at, finished_at FROM discovery_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1"),
      query<{ status: string; finished_at: Date | null }>("SELECT status, finished_at FROM discovery_runs ORDER BY id DESC LIMIT 1"),
      query<{ last_success_at: Date | null; last_run_at: Date | null; consecutive_failures: number }>("SELECT last_success_at, last_run_at, consecutive_failures FROM sources WHERE id = 'funding_rss'"),
      query<{ id: string }>("SELECT id FROM sources WHERE enabled AND consecutive_failures > 0").then((rows) => [{ n: String(rows.filter((r) => !disabledByConfig(r.id)).length) }]),
    ]);
    if (user) await maybeAutoRefreshDiscovery().catch((e) => console.error("[live] discovery kick failed:", (e as Error).message));
    await maybeRefreshNewsInBackground(rss?.last_success_at ?? null).catch((e) => console.error("[live] news kick failed:", (e as Error).message));

    const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
    const run = runStatus();
    const discoveryAt = iso(done?.finished_at ?? done?.started_at);
    const newsAt = iso(rss?.last_success_at);
    const discoveryFailed = lastRun?.status === "failed";
    const newsFailed = (rss?.consecutive_failures ?? 0) > 0;
    const lastSuccessAt = [discoveryAt, newsAt].filter(Boolean).sort().pop() ?? null;
    const running = run.running || newsRefreshing();
    const failed = !running && (discoveryFailed || newsFailed);
    return NextResponse.json({
      app: { ok: true },
      refresh: { state: running ? "refreshing" : failed ? "failed" : "idle", lastSuccessAt, lastFailureAt: failed ? iso(lastRun?.finished_at) ?? iso(rss?.last_run_at) : null },
      // Cached data is on screen only when the newest refresh failed and an older good copy exists.
      servingCache: failed && !!lastSuccessAt,
      sourcesNeedingAttention: Number(att?.n ?? 0),
      version: `${done?.id ?? 0}|${discoveryAt ?? ""}|${newsAt ?? ""}`,
      discovery: { running: run.running, finishedAt: discoveryAt },
      news: { refreshing: newsRefreshing(), checkedAt: newsAt },
      staleAfterMinutes: { discovery: settings.live.discoveryStaleMinutes, news: settings.live.newsStaleMinutes },
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[api/live]", (e as Error).message);
    return NextResponse.json({ error: "live_unavailable", retryAfterSeconds: 15 }, { status: 503, headers: { "Retry-After": "15" } });
  }
}
