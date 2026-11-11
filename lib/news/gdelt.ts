// GDELT DOC 2.0 API as a SECONDARY article-discovery provider (off unless GDELT_ENABLED=true).
// Documented interface (api.gdeltproject.org/api/v2/doc/doc): GET with query, mode=ArtList, maxrecords, format=json, timespan.
// Operators go inside `query` (quoted phrases, OR in parentheses, sourcelang:, sourcecountry:). Limit: one request per 5 seconds
// (faster calls get HTTP 429). No key. We send ONE request per refresh.
//
// What GDELT is and is not used for:
//  - It only DISCOVERS candidate article URLs and headlines. Every candidate must still pass the same headline parser as the RSS
//    feeds (parseFundingHeadline + NOT_A_RAISE); anything that does not state a raise is dropped.
//  - `seendate` is when GDELT first SAW the URL, NOT when the publisher published it. It is stored as provider_seen_at and is never
//    shown as a publication date (the card says the source gave none).
//  - Article JSON field names (url, title, seendate, domain, language, sourcecountry) follow GDELT's ArtList output; they could not be
//    confirmed against the live API from the build sandbox, so the parser is tolerant and the provider ships disabled.
import { cachedTextInfo } from "@/lib/http";
import { settings } from "@/config/settings";
import type { ArticleInput } from "./store";

export const GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
export const GDELT_QUERY = '(startup OR startups) (raises OR raised OR funding OR "Series A" OR "Series B" OR seed) sourcelang:english sourcecountry:india';

export function gdeltUrl(maxRecords = 75): string {
  const u = new URL(GDELT_ENDPOINT);
  u.searchParams.set("query", GDELT_QUERY);
  u.searchParams.set("mode", "ArtList");
  u.searchParams.set("maxrecords", String(Math.min(250, Math.max(1, maxRecords))));
  u.searchParams.set("format", "json");
  u.searchParams.set("timespan", "1week");
  u.searchParams.set("sort", "datedesc");
  return u.toString();
}

/** GDELT seendate is "YYYYMMDDTHHMMSSZ". Returns ISO text or null. */
export function parseSeenDate(raw: unknown): string | null {
  const m = typeof raw === "string" ? raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Validates the body (throws on anything that is not an article list) and returns candidates. publishedAt is always null. */
export function parseGdelt(body: string): ArticleInput[] {
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("response was not JSON"); // GDELT answers plain-text errors (e.g. rate-limit or bad query) with 200 or 429
  }
  if (!data || typeof data !== "object") throw new Error("unexpected response");
  if (data.articles === undefined) return []; // an empty result has no articles key
  if (!Array.isArray(data.articles)) throw new Error("articles is not a list");
  const out: ArticleInput[] = [];
  for (const a of data.articles) {
    if (!a || typeof a.url !== "string" || typeof a.title !== "string") continue;
    const domain = typeof a.domain === "string" ? a.domain.replace(/^www\./, "") : "";
    out.push({ url: a.url, headline: a.title, publisher: domain || hostOf(a.url), summary: null, publishedAt: null, seenAt: parseSeenDate(a.seendate), provider: "gdelt" });
  }
  return out;
}

const hostOf = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
};

export async function searchGdelt(): Promise<ArticleInput[]> {
  const r = await cachedTextInfo(gdeltUrl(), settings.cacheHours.gdelt, { skipRobots: true, retries: 1, allowStale: false, validate: (b) => void parseGdelt(b) });
  return parseGdelt(r.body);
}
