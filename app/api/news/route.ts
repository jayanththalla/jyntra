import { NextRequest, NextResponse } from "next/server";
import { listArticles } from "@/lib/news/store";
import { CITY_BY_ID, SECTOR_BY_ID, type Verification } from "@/lib/news/taxonomy";
import { maybeRefreshNewsInBackground, newsProviderStatus } from "@/lib/news/refresh";
import { rateLimit } from "@/lib/rate-limit";
import { describeSources } from "@/lib/refresh/health";

export const dynamic = "force-dynamic";

const DAYS = new Set([7, 30, 90, 365]);

/** Publisher homepages. Shown ONLY when there are no stored articles, and always labelled as a directory, never as news. */
const DIRECTORY = [
  { name: "Inc42", url: "https://inc42.com/buzz/" },
  { name: "YourStory", url: "https://yourstory.com/" },
  { name: "TechCrunch Startups", url: "https://techcrunch.com/category/startups/" },
  { name: "Entrackr", url: "https://entrackr.com/" },
];

/**
 * GET /api/news?q=&publisher=&days=7|30|90|365&verification=verified|single_source|unconfirmed&city=<id|unknown>&sector=<id>&page=1&limit=20
 * Reads stored articles only (no external call per request). If the data is older than 3 hours a refresh is started
 * in the background (stale-while-revalidate). Articles have the publisher's date or null, never a guessed one.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;

  const days = sp.get("days") ? Number(sp.get("days")) : undefined;
  if (days !== undefined && !DAYS.has(days)) return NextResponse.json({ error: "invalid_days" }, { status: 400 });
  const page = Number(sp.get("page") ?? 1);
  const limit = Number(sp.get("limit") ?? 20);
  if (!Number.isInteger(page) || page < 1 || page > 200 || !Number.isInteger(limit) || limit < 1 || limit > 30) {
    return NextResponse.json({ error: "invalid_paging" }, { status: 400 });
  }
  const q = (sp.get("q") ?? "").trim().slice(0, 100) || undefined;
  const kind = sp.get("kind") === "confirmed" ? ("confirmed" as const) : undefined;
  const round = (sp.get("round") ?? "").trim().slice(0, 40) || undefined;
  const investor = (sp.get("investor") ?? "").trim().slice(0, 80) || undefined;
  const hiring = sp.get("hiring") === "1";
  const sort = sp.get("sort") === "amount" ? ("amount" as const) : ("recent" as const);
  const v = sp.get("verification");
  const verification = v === "verified" || v === "single_source" || v === "unconfirmed" ? (v as Verification) : undefined;
  if (v && !verification) return NextResponse.json({ error: "invalid_verification" }, { status: 400 });
  // City and sector are matched against our fixed lists; anything else is rejected instead of silently returning nothing.
  const cityRaw = (sp.get("city") ?? "").trim();
  if (cityRaw && cityRaw !== "unknown" && !CITY_BY_ID.has(cityRaw)) return NextResponse.json({ error: "invalid_city" }, { status: 400 });
  const sectorRaw = (sp.get("sector") ?? "").trim();
  if (sectorRaw && !SECTOR_BY_ID.has(sectorRaw)) return NextResponse.json({ error: "invalid_sector" }, { status: 400 });
  const publisher = (sp.get("publisher") ?? "").trim().slice(0, 80) || undefined;

  try {
    const [list, providers, health] = await Promise.all([listArticles({ q, publisher, kind, verification, city: cityRaw || undefined, sector: sectorRaw || undefined, days, round, investor, hiring, sort, limit, offset: (page - 1) * limit }), newsProviderStatus(), describeSources()]);
    const rss = providers.find((p) => p.id === "funding_rss");
    // Staleness is judged by the last successful READ of the feeds, not by the newest article's time.
    const refreshing = await maybeRefreshNewsInBackground(rss?.last_success_at ?? list.last_checked_at);
    const hasAnyArticles = list.last_checked_at !== null;
    const state = hasAnyArticles ? "ok" : rss && rss.consecutive_failures > 0 ? "unavailable" : "empty";
    return NextResponse.json({
      state,
      articles: list.articles,
      total: list.total,
      page,
      limit,
      publishers: list.publishers,
      rounds: list.rounds,
      investors: list.investors,
      facets: list.facets,
      last_checked_at: list.last_checked_at,
      refreshing,
      // Concise, user-facing source notes only (no raw errors). Healthy providers keep serving while one fails.
      source_notes: health.sources.filter((x) => x.kind === "news" && x.message).map((x) => ({ id: x.id, message: x.message })),
      serving_cache: state === "ok" && health.sources.some((x) => x.kind === "news" && x.state === "failing"),
      message:
        state === "unavailable"
          ? "Funding sources could not be reached on the last attempt. They will be retried automatically."
          : state === "empty"
          ? "No verified funding articles yet. Sources are checked automatically."
          : undefined,
      directory: hasAnyArticles ? undefined : DIRECTORY,
    });
  } catch (e) {
    console.error("[api/news]", (e as Error).message);
    return NextResponse.json({ error: "news_unavailable" }, { status: 503 });
  }
}
