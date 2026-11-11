import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/refresh/auth";
import { rateLimit } from "@/lib/rate-limit";
import { refreshNews } from "@/lib/news/refresh";
import { startDiscovery, runStatus } from "@/lib/discovery/run";
import { ready } from "@/lib/database";
import { describeSources } from "@/lib/refresh/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/cron/refresh?scope=all|news|discovery|companies|health
 * For a scheduler or an operator. Requires `Authorization: Bearer $CRON_SECRET` (or `x-cron-secret`).
 *  - news:       runs inline (seconds) and returns a per-provider report.
 *  - discovery:  starts in the background (can take minutes) and returns 202 immediately.
 * Locks: PostgreSQL advisory locks stop overlapping runs, even across several instances.
 * Nothing is scheduled by this endpoint itself: see docs/SCHEDULING.md.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "cron");
  if (limited) return limited;
  const auth = checkCronAuth(req);
  if (auth === "not_configured") return NextResponse.json({ error: "refresh_not_configured" }, { status: 503 });
  if (auth === "denied") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = new URL(req.url).searchParams.get("scope") ?? "all";
  if (!["all", "news", "discovery", "companies", "boards", "ingest", "discover", "health"].includes(scope)) return NextResponse.json({ error: "invalid_scope" }, { status: 400 });

  try {
    await ready();
    if (scope === "health") {
      // Read-only gate for a scheduler: 503 when any enabled source is failing, stale or has never run.
      const h = await describeSources();
      return NextResponse.json({ scope, ...h, healthy: h.attention.length === 0 }, { status: h.attention.length ? 503 : 200 });
    }
    const body: Record<string, unknown> = { scope };
    let started = false;
    if (scope === "news" || scope === "all") {
      const n = await refreshNews();
      body.news = n.ran ? n.report : { skipped: "another news refresh is already running" };
    }
    if (scope === "discovery" || scope === "all") {
      started = startDiscovery(); // in-process guard; the database lock inside protects across instances
      const s = runStatus();
      body.discovery = { started, alreadyRunning: !started, running: s.running, startedAt: s.startedAt, stats: s.stats };
    }
    if (scope === "boards" || scope === "ingest") {
      // Bounded pass of the durable ingestion schedule (due sources only). `boards` is kept as an alias of `ingest`.
      const { runPass } = await import("@/lib/ingestion/scheduler");
      body.ingest = await runPass({ limit: 25, budgetMs: 45_000 });
    }
    if (scope === "discover") {
      const { processQueue } = await import("@/lib/ingestion/discovery/pipeline");
      body.discover = await processQueue({ limit: 10 });
    }
    if (scope === "companies") {
      const { startCompanyJobSync } = await import("@/lib/company-jobs/sync");
      const kicked = startCompanyJobSync();
      body.companies = { started: kicked, alreadyRunning: !kicked };
      if (kicked) started = true;
    }
    return NextResponse.json(body, { status: started ? 202 : 200 });
  } catch (e) {
    console.error("[cron/refresh]", (e as Error).message);
    return NextResponse.json({ error: "refresh_failed" }, { status: 500 });
  }
}

// Other methods are deliberately not allowed: a GET must never trigger work (link previews, crawlers).
export async function GET() {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}
