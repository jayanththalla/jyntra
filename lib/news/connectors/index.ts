// Funding source connectors. Each connector is a small definition (id, label, URL, kind); the runner fetches, parses, keeps only
// stories that state a raise (isFundingArticle) and are not stale, and hands ArticleInput rows to the EXISTING upsert pipeline
// (dedupe by URL, fingerprint, near-duplicate and same-raise grouping). Nothing here replaces the working RSS/Tavily/GDELT providers.
//
//  kind "news"      ordinary publication feed (verification comes from how many outlets carry the story)
//  kind "official"  a company press-release feed or investor announcement feed: the announcement itself, so stories are marked official
//  kind "investor"  a VC firm's portfolio-news or blog feed (treated as official for the firm's own deals)
//
// Sources are CONFIGURED, not guessed: built-ins below plus FUNDING_EXTRA_FEEDS / FUNDING_OFFICIAL_FEEDS. A feed that is down is
// recorded in health and skipped; last-good data stays in the database.
import { httpRequest } from "@/lib/ingestion/http";
import { safeHttpUrl } from "@/lib/url";
import { query } from "@/lib/database";
import { isFundingArticle, type ArticleInput } from "@/lib/news/store";
import { NOT_A_RAISE } from "@/lib/news/feeds";
import { parseFeed, parseFeedDate, isTooOld, looksLikeFeed } from "./feed";

export type ConnectorKind = "news" | "official" | "investor";
export interface ConnectorDef { id: string; label: string; url: string; kind: ConnectorKind }
type Env = Record<string, string | undefined>;

/** Built-in extras. The core feeds (Inc42, ET, Entrackr, YourStory, TechCrunch, Crunchbase News) stay in lib/news/feeds.ts. */
export const BUILTIN_CONNECTORS: ConnectorDef[] = [
  { id: "techcrunch-india", label: "TechCrunch (India)", url: "https://techcrunch.com/tag/india/feed/", kind: "news" },
];

export const connectorsEnabled = (env: Env = process.env) => (env.FUNDING_CONNECTORS_ENABLED ?? "true").trim().toLowerCase() !== "false";

/** "Name|https://feed.url[,Name2|https://…]" → definitions. Invalid entries are ignored (and never fetched). HTTPS only. */
export function parseConnectorList(raw: string | undefined, kind: ConnectorKind): ConnectorDef[] {
  const out: ConnectorDef[] = [];
  for (const part of (raw ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const [name, ...rest] = part.split("|");
    const url = safeHttpUrl(rest.join("|").trim());
    if (!name?.trim() || !url || !url.startsWith("https://")) continue;
    out.push({ id: `${kind}-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 60), label: name.trim().slice(0, 60), url, kind });
  }
  return out;
}
export function configuredConnectors(env: Env = process.env): ConnectorDef[] {
  if (!connectorsEnabled(env)) return [];
  const all = [...BUILTIN_CONNECTORS, ...parseConnectorList(env.FUNDING_EXTRA_FEEDS, "news"), ...parseConnectorList(env.FUNDING_OFFICIAL_FEEDS, "official"), ...parseConnectorList(env.FUNDING_INVESTOR_FEEDS, "investor")];
  const seen = new Set<string>(); return all.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

export interface ConnectorResult { id: string; label: string; ok: boolean; fetched: number; kept: number; skippedOld: number; error?: string; articles: ArticleInput[] }
export type FetchText = (url: string) => Promise<string>;
export const defaultFetchText: FetchText = async (url) => (await httpRequest(url, { timeoutMs: 10_000, maxBytes: 2_500_000, headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" } })).text;

const category = (e: unknown) => (/timeout/i.test(String((e as Error)?.message)) ? "timeout" : /429|rate/i.test(String((e as Error)?.message)) ? "rate_limited" : /not a feed/i.test(String((e as Error)?.message)) ? "bad_response" : "network");

export async function runConnector(def: ConnectorDef, fetchText: FetchText = defaultFetchText, now = Date.now()): Promise<ConnectorResult> {
  const base = { id: def.id, label: def.label };
  try {
    const body = await fetchText(def.url);
    if (!looksLikeFeed(body)) throw new Error("not a feed");
    const items = parseFeed(body);
    const articles: ArticleInput[] = []; let skippedOld = 0;
    for (const it of items) {
      const title = it.title.replace(/^\[[^\]]+\]\s*/, "");
      if (NOT_A_RAISE.test(title) || !isFundingArticle(title, it.description)) continue;
      const published = parseFeedDate(it.published, now);
      if (isTooOld(published, now)) { skippedOld++; continue; }       // an old story is not a new round
      articles.push({ url: it.link, headline: title, publisher: def.label, summary: it.description || null, publishedAt: published, provider: "rss", connector: def.id, official: def.kind !== "news" });
    }
    return { ...base, ok: true, fetched: items.length, kept: articles.length, skippedOld, articles };
  } catch (e) {
    return { ...base, ok: false, fetched: 0, kept: 0, skippedOld: 0, error: category(e), articles: [] };
  }
}

async function recordRun(r: ConnectorResult, stored: number, startedAt: Date) {
  await query("INSERT INTO funding_connector_runs (connector, started_at, finished_at, ok, fetched, stored, error_category, note) VALUES ($1,$2,now(),$3,$4,$5,$6,$7)", [r.id, startedAt, r.ok, r.fetched, stored, r.ok ? null : r.error ?? "network", r.ok ? `${r.kept} funding stories, ${r.skippedOld} too old` : null]).catch(() => {});
  await query(
    `INSERT INTO feed_health (provider, feed, last_run_at, last_success_at, consecutive_failures, last_error_category, served_cache)
     VALUES ('funding_connector', $1, now(), CASE WHEN $2 THEN now() END, CASE WHEN $2 THEN 0 ELSE 1 END, $3, false)
     ON CONFLICT (provider, feed) DO UPDATE SET last_run_at = now(), last_success_at = CASE WHEN $2 THEN now() ELSE feed_health.last_success_at END,
       consecutive_failures = CASE WHEN $2 THEN 0 ELSE feed_health.consecutive_failures + 1 END, last_error_category = $3`,
    [r.id, r.ok, r.ok ? null : r.error ?? "network"]).catch(() => {});
}

/** Runs every configured connector independently (one failing never stops the others). Used by refreshNews(). */
export async function runAllConnectors(opts: { env?: Env; fetchText?: FetchText; store: (a: ArticleInput[]) => Promise<{ inserted: number }>; now?: number }): Promise<{ results: ConnectorResult[]; articles: ArticleInput[]; partialError?: string }> {
  const defs = configuredConnectors(opts.env);
  const results: ConnectorResult[] = []; const all: ArticleInput[] = [];
  for (const d of defs) {
    const t0 = new Date();
    const r = await runConnector(d, opts.fetchText, opts.now);
    let stored = 0;
    if (r.ok && r.articles.length) stored = (await opts.store(r.articles)).inserted;   // per connector, so run history is accurate
    await recordRun(r, stored, t0);
    results.push({ ...r, articles: [] }); all.push(...r.articles);
  }
  const failed = results.filter((r) => !r.ok);
  return { results, articles: [], partialError: failed.length ? failed.map((f) => `${f.label}: ${f.error}`).join("; ") : undefined };
}

export async function connectorHealth() {
  return query<{ connector: string; last_run: string; ok: boolean; fetched: number; stored: number; error_category: string | null }>(
    "SELECT DISTINCT ON (connector) connector, started_at AS last_run, ok, fetched, stored, error_category FROM funding_connector_runs ORDER BY connector, started_at DESC");
}
