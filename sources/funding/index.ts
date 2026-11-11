// Funding news from public RSS feeds. Only headlines that explicitly announce a raise are used,
// and the article link is stored as the funding source URL.
import type { DiscoveryContext, Headquarters, StartupResult, StartupSource } from "@/lib/types";
import { cachedText } from "@/lib/http";
import { parseAmount, parseFundingHeadline } from "@/lib/funding";
import { countryFromLocation } from "@/lib/country";
import { normalizeName } from "@/lib/deduplication";
import { settings } from "@/config/settings";
import { FEEDS, NOT_A_RAISE, parseRss, type RssItem } from "@/lib/news/feeds";
import { upsertArticles, type ArticleInput } from "@/lib/news/store";

export { parseRss };
export type { RssItem };

const NOT_COMPANY_SITES =
  /(^|\.)(twitter|x|linkedin|facebook|instagram|youtube|threads|mstdn|t|wa|whatsapp|telegram|reddit|medium|substack|google|apple|bit|crunchbase|tracxn|strictlyvc|techcrunch|yourstory|inc42|economictimes|indiatimes|livemint|moneycontrol|wikipedia|github|ycombinator|wellfound|amazonaws|cloudfront|wp|wordpress|gravatar|doubleclick|disqus)\.[a-z.]+$/i;

/**
 * The startup's website, but only if the article itself links to a domain whose name matches the
 * company (e.g. "Restate" → restate.dev). Never guessed.
 */
export async function websiteFromArticle(articleUrl: string, company: string): Promise<string | null> {
  const want = normalizeName(company);
  if (want.length < 4) return null;
  let html: string;
  try {
    html = await cachedText(articleUrl, 24 * 7);
  } catch {
    return null; // blocked by robots / 403 / network — leave unknown
  }
  const articleHost = new URL(articleUrl).hostname.replace(/^www\./, "");
  for (const m of html.matchAll(/href=["'](https?:\/\/[^"'#\s]+)["']/gi)) {
    let host: string;
    try {
      host = new URL(m[1]).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      continue;
    }
    if (host.endsWith(articleHost) || NOT_COMPANY_SITES.test(host)) continue;
    const label = host.split(".").slice(-2, -1)[0]?.replace(/[^a-z0-9]/g, "") ?? "";
    if (label.length >= 4 && (label === want || label.startsWith(want) || want.startsWith(label))) {
      return `https://${host}`;
    }
  }
  return null;
}


/** Headquarters evidence from the article: "Bengaluru-based Foo" (medium), else an amount in ₹ (low). */
export function hqFromArticle(locationHint: string | null, amount: string | null, outlet: string, url: string): Headquarters | null {
  const country = countryFromLocation(locationHint);
  if (country) {
    const phrase = /^(India|United States)$/.test(locationHint ?? "")
      ? `described as ${locationHint === "India" ? "an Indian" : "a US"} company`
      : `“${locationHint}-based”`;
    return { country, confidence: "medium", evidence: `${phrase} in ${outlet} headline`, sourceUrl: url };
  }
  if (parseAmount(amount)?.currency === "INR") {
    return { country: "India", confidence: "low", evidence: `Round announced in ₹ (${outlet})`, sourceUrl: url };
  }
  return null;
}

export const fundingSource: StartupSource = {
  id: "funding_rss",
  name: "Funding news (Inc42, ET, Entrackr, YourStory, TechCrunch, Crunchbase News)",
  disabledReason: () => null,

  async discover(ctx: DiscoveryContext): Promise<StartupResult[]> {
    const out: StartupResult[] = [];
    const seenLinks = new Set<string>(); // the two TechCrunch feeds overlap
    // Feeds are on different hosts, so they are read at the same time; one slow feed no longer delays the others.
    const readFeed = async (feed: (typeof FEEDS)[number]) => {
      let items: RssItem[];
      try {
        items = parseRss(await cachedText(feed.url, settings.cacheHours.rss));
      } catch (e) {
        ctx.log(`Funding: ${feed.name} failed (${(e as Error).message})`);
        failedFeeds++;
        return;
      }
      let lookups = 0;
      let found = 0;
      let websites = 0;
      let unconfirmed = 0;
      const toStore: ArticleInput[] = [];
      for (const item of items) {
        if (seenLinks.has(item.link)) continue;
        seenLinks.add(item.link);
        const title = item.title.replace(/^\[[^\]]+\]\s*/, "");
        if (NOT_A_RAISE.test(title)) continue;
        const parsed = parseFundingHeadline(title, item.description);
        if (!parsed) continue;
        found++;
        if (parsed.kind !== "confirmed") unconfirmed++;
        toStore.push({ url: item.link, headline: title, publisher: feed.name, summary: item.description || null, publishedAt: item.pubDate, provider: "rss" });
        const date = item.pubDate && !isNaN(Date.parse(item.pubDate)) ? new Date(item.pubDate).toISOString().slice(0, 10) : null;
        // Each lookup is a page fetch with a per-host delay, so only the newest few per feed are followed.
        const website = lookups++ < settings.fundingWebsiteLookupsPerFeed ? await websiteFromArticle(item.link, parsed.company) : null;
        if (website) websites++;
        out.push({
          name: parsed.company,
          website,
          description: item.description || null,
          location: parsed.locationHint,
          source: "funding_rss",
          sourceUrl: item.link,
          funding: {
            date,
            amount: parsed.amount,
            round: parsed.round,
            investors: parsed.investors,
            source: feed.name,
            sourceUrl: item.link,
            kind: parsed.kind,
          },
          hq: hqFromArticle(parsed.locationHint, parsed.amount, feed.name, item.link),
          jobs: [],
        });
      }
      try {
        const r = await upsertArticles(toStore);
        ctx.log(`Funding: ${feed.name} articles stored — ${r.inserted} new, ${r.updated} already known, ${r.nearDuplicates} near-duplicates skipped.`);
      } catch (e) {
        ctx.log(`Funding: could not store ${feed.name} articles (${(e as Error).message})`);
      }
      ctx.log(
        `Funding: ${feed.name} — ${items.length} articles, ${found} funding announcements${unconfirmed ? ` (${unconfirmed} planned/unconfirmed)` : ""}, ${websites} company websites found in articles.`
      );
    };
    let failedFeeds = 0;
    await Promise.all(FEEDS.map(readFeed));
    // Every feed failing is a source failure, not "no funding news today": surface it so the run is not shown as healthy.
    if (failedFeeds === FEEDS.length) throw new Error("none of the funding news feeds could be reached");
    return out;
  },
};
