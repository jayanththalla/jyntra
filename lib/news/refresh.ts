// Refreshes the funding-news table from every configured provider. Safe to call from anywhere:
// a database advisory lock guarantees only one refresh runs at a time, across all processes.
import { runAllConnectors, connectorsEnabled } from "./connectors";
import { enrichPending, enrichmentEnabled } from "./company-enrich";
import { newsRefreshSettings } from "./schedule";
import { query } from "@/lib/database";
import { FetchError, cachedTextInfo, errorCategory } from "@/lib/http";
import { parseFundingHeadline } from "@/lib/funding";
import { settings } from "@/config/settings";
import { withAdvisoryLock } from "@/lib/refresh/lock";
import { recordSourceRun } from "@/lib/refresh/health";
import { gdeltEnabled } from "@/lib/providers/config";
import { searchGdelt } from "./gdelt";
import { FEEDS, NOT_A_RAISE, parseRss } from "./feeds";
import { googleConfigured, searchGoogleLegacy, searchTavily, tavilyConfigured } from "./providers";
import { isFundingArticle, upsertArticles, type ArticleInput } from "./store";
import { enrichArticles, type EnrichReport } from "./enrich";

export interface ProviderReport {
  id: string;
  ok: boolean;
  skipped?: string;
  inserted: number;
  updated: number;
  nearDuplicates: number;
  error?: string;
  durationMs: number;
}
export interface NewsRefreshReport {
  startedAt: string;
  providers: ProviderReport[];
  /** City and sector classification of stories stored by this run. */
  enrichment?: EnrichReport;
  /** Official website / LinkedIn / careers verification pass. */
  companyLinks?: { checked: number; verified: number; partial: number; unverified: number; error?: string };
}

async function timed(id: string, fn: () => Promise<ArticleInput[] | { articles: ArticleInput[]; partialError?: string }>): Promise<ProviderReport> {
  const t0 = Date.now();
  try {
    const r = await fn();
    // Every provider's candidates must themselves state a raise before they are stored.
    const articles = (Array.isArray(r) ? r : r.articles).filter((a) => isFundingArticle(a.headline, a.summary));
    const partialError = Array.isArray(r) ? undefined : r.partialError;
    const s = await upsertArticles(articles);
    const durationMs = Date.now() - t0;
    await recordSourceRun(id, { ok: true, durationMs, note: `${articles.length} articles (${s.inserted} new)${partialError ? `; partial: ${partialError}` : ""}` });
    return { id, ok: true, inserted: s.inserted, updated: s.updated, nearDuplicates: s.nearDuplicates, durationMs };
  } catch (e) {
    const durationMs = Date.now() - t0;
    const error = (e as Error).message;
    await recordSourceRun(id, { ok: false, error, category: errorCategory(e), retryAfterSeconds: e instanceof FetchError ? e.retryAfterSeconds : undefined, durationMs }).catch(() => {});
    return { id, ok: false, inserted: 0, updated: 0, nearDuplicates: 0, error, durationMs };
  }
}

async function recordFeed(feed: string, ok: boolean, category: string | null, servedCache: boolean) {
  await query(
    `INSERT INTO feed_health (provider, feed, last_run_at, last_success_at, consecutive_failures, last_error_category, served_cache)
     VALUES ('funding_rss', $1, now(), CASE WHEN $2 THEN now() END, CASE WHEN $2 THEN 0 ELSE 1 END, $3, $4)
     ON CONFLICT (provider, feed) DO UPDATE SET last_run_at = now(),
       last_success_at = CASE WHEN $2 THEN now() ELSE feed_health.last_success_at END,
       consecutive_failures = CASE WHEN $2 THEN 0 ELSE feed_health.consecutive_failures + 1 END,
       last_error_category = $3, served_cache = $4`,
    [feed, ok, ok ? null : category, servedCache]
  ).catch(() => {});
}

async function fromFeeds(): Promise<{ articles: ArticleInput[]; partialError?: string }> {
  const articles: ArticleInput[] = [];
  const failed: string[] = [];
  await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        // A feed answered from an OLD cached copy is a failed read: its stories are still usable, but it must not count as a success.
        const r = await cachedTextInfo(feed.url, settings.cacheHours.rss, { validate: (b) => { if (!/<(rss|feed|rdf:RDF)\b/i.test(b)) throw new Error("not a feed"); } });
        const items = parseRss(r.body);
        if (r.from === "stale") {
          failed.push(`${feed.name}: ${r.error?.category ?? "network"} (served cached copy)`);
          await recordFeed(feed.name, false, r.error?.category ?? "network", true);
        } else await recordFeed(feed.name, true, null, false);
        for (const it of items) {
          const title = it.title.replace(/^\[[^\]]+\]\s*/, "");
          if (NOT_A_RAISE.test(title) || !parseFundingHeadline(title, it.description)) continue;
          articles.push({ url: it.link, headline: title, publisher: feed.name, summary: it.description || null, publishedAt: it.pubDate, provider: "rss" });
        }
      } catch (e) {
        failed.push(`${feed.name}: ${errorCategory(e)}`);
        await recordFeed(feed.name, false, errorCategory(e), false);
      }
    })
  );
  if (failed.length === FEEDS.length) throw new FetchError(`all feeds failed (${failed.join("; ")})`, undefined, "network");
  return { articles, partialError: failed.length ? failed.join("; ") : undefined };
}

/** Runs one refresh. Returns { ran: false } if another refresh (any process) already holds the lock. */
export async function refreshNews(): Promise<{ ran: false } | { ran: true; report: NewsRefreshReport }> {
  const out = await withAdvisoryLock("news-refresh", async () => {
    const report: NewsRefreshReport = { startedAt: new Date().toISOString(), providers: [] };
    report.providers.push(await timed("funding_rss", fromFeeds));
    // Extra connectors (official/investor/news feeds). Each stores its own rows and keeps its own run history; one failing never stops the rest.
    if (connectorsEnabled()) report.providers.push(await timed("funding_connectors", async () => runAllConnectors({ store: upsertArticles })));
    // Optional providers only run when their key exists; each is one bounded query.
    if (tavilyConfigured()) report.providers.push(await timed("tavily", () => searchTavily(10)));
    if (gdeltEnabled()) report.providers.push(await timed("gdelt", searchGdelt));
    if (googleConfigured()) report.providers.push(await timed("google_cse", () => searchGoogleLegacy(10)));
    // Always last: classify whatever this run stored (and anything an earlier run missed). A failure here never fails the refresh.
    report.enrichment = await enrichArticles().catch((e) => ({ enriched: 0, aiClassified: 0, error: (e as Error).message.slice(0, 120) }));
    // Verified website / LinkedIn / careers links for newly funded companies. Bounded, polite, and never fails the refresh.
    if (enrichmentEnabled()) report.companyLinks = await enrichPending(5).catch((e) => ({ checked: 0, verified: 0, partial: 0, unverified: 0, error: (e as Error).message.slice(0, 120) }));
    return report;
  });
  return out.ran ? { ran: true, report: out.value } : { ran: false };
}

const g = globalThis as unknown as { __newsKickAt?: number; __newsRunning?: boolean };
const NEWS_TTL_MS = newsRefreshSettings().intervalMinutes * 60_000;
const KICK_MIN_GAP_MS = 5 * 60_000; // even if refreshes keep failing, try at most every 5 minutes per process

/** True while this process is running a background news refresh (the UI shows "Updating"). */
export const newsRefreshing = () => !!g.__newsRunning;

/**
 * Stale-while-revalidate: reads never wait for the network. If the newest data is older than the TTL, a refresh
 * is started in the background and the next read sees it.
 */
export async function maybeRefreshNewsInBackground(lastCheckedAt: string | Date | null): Promise<boolean> {
  if (!newsRefreshSettings().enabled) return false;   // FUNDING_NEWS_REFRESH_ENABLED=false: only the scheduler / manual refresh runs it
  const stale = !lastCheckedAt || Date.now() - new Date(lastCheckedAt).getTime() > NEWS_TTL_MS;
  if (!stale || Date.now() - (g.__newsKickAt ?? 0) < KICK_MIN_GAP_MS) return false;
  g.__newsKickAt = Date.now();
  g.__newsRunning = true;
  refreshNews()
    .catch((e) => console.error("[news] background refresh failed:", (e as Error).message))
    .finally(() => {
      g.__newsRunning = false;
    });
  return true;
}

export async function newsProviderStatus() {
  return query<{ id: string; last_run_at: string | null; last_success_at: string | null; last_status: string | null; consecutive_failures: number }>(
    "SELECT id, last_run_at, last_success_at, last_status, consecutive_failures FROM sources WHERE id IN ('funding_rss','funding_connectors','tavily','google_cse','gdelt')"
  );
}
