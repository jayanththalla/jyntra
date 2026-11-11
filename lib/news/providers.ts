// Optional keyed news providers. Both run on the server only; keys never reach the browser.
//  - Tavily (recommended extra): https://docs.tavily.com — Bearer auth, topic "news", 1 credit per basic search.
//  - Google Custom Search JSON API: DEPRECATED. Closed to new customers; Google retires it on 2027-01-01.
//    Kept only so existing installs keep working until then.
import type { ArticleInput } from "./store";

const TIMEOUT_MS = 10_000;
const FUNDING_QUERY = "startup raises funding round seed Series A India";

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function tavilyConfigured() {
  return !!process.env.TAVILY_API_KEY;
}
export function googleConfigured() {
  return !!(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX);
}

export async function searchTavily(maxResults = 10): Promise<ArticleInput[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ query: FUNDING_QUERY, topic: "news", search_depth: "basic", max_results: maxResults, time_range: "month", include_answer: false }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r: { url?: string; title?: string }) => r.url && r.title)
    .map((r: { url: string; title: string; content?: string; published_date?: string }) => ({
      url: r.url,
      headline: r.title,
      publisher: host(r.url),
      summary: r.content ?? null,
      publishedAt: r.published_date ?? null, // the provider's own date, or null
      provider: "tavily" as const,
    }));
}

export async function searchGoogleLegacy(maxResults = 10): Promise<ArticleInput[]> {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", process.env.GOOGLE_SEARCH_API_KEY!);
  url.searchParams.set("cx", process.env.GOOGLE_SEARCH_CX!);
  url.searchParams.set("q", FUNDING_QUERY);
  url.searchParams.set("num", String(Math.min(10, maxResults)));
  url.searchParams.set("sort", "date");
  url.searchParams.set("dateRestrict", "m3");
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`); // body not included: it can echo the request URL (with the key)
  const data = await res.json();
  return (data.items ?? [])
    .filter((i: { link?: string; title?: string }) => i.link && i.title)
    .map((i: { link: string; title: string; snippet?: string; pagemap?: any }) => ({
      url: i.link,
      headline: i.title,
      publisher: host(i.link),
      summary: i.snippet ?? null,
      publishedAt: i.pagemap?.metatags?.[0]?.["article:published_time"] ?? null,
      provider: "google_cse" as const,
    }));
}
