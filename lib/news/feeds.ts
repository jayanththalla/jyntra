// Funding-news RSS feeds (free, no API key) and a small tolerant RSS parser.
import { stripHtml } from "@/lib/text";

/** India-focused outlets first; the outlet's country is never used as the startup's country. */
export const FEEDS = [
  { name: "Inc42", url: "https://inc42.com/feed/" },
  { name: "Economic Times (Tech funding)", url: "https://economictimes.indiatimes.com/tech/funding/rssfeeds/78570550.cms" },
  { name: "Economic Times (Startups)", url: "https://economictimes.indiatimes.com/tech/startups/rssfeeds/78570540.cms" },
  { name: "Entrackr", url: "https://entrackr.com/rss" },
  { name: "YourStory", url: "https://yourstory.com/feed" },
  { name: "TechCrunch (Fundraising)", url: "https://techcrunch.com/category/fundraising/feed/" },
  { name: "TechCrunch (Startups)", url: "https://techcrunch.com/category/startups/feed/" },
  { name: "Crunchbase News", url: "https://news.crunchbase.com/feed/" },
] as const;

export interface RssItem {
  title: string;
  link: string;
  pubDate: string | null;
  description: string;
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return null;
  // Some feeds (ET) put whitespace around the CDATA block, so strip the markers anywhere.
  return m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

function decode(s: string) {
  return s
    .replace(/&#0?38;|&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8377;/g, "₹")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const it = m[0];
    const title = decode(tag(it, "title") ?? "");
    const link = (tag(it, "link") ?? "").trim();
    if (!title || !link) continue;
    items.push({
      title,
      link,
      pubDate: tag(it, "pubDate"),
      description: stripHtml(decode(tag(it, "description") ?? "")).slice(0, 600),
    });
  }
  return items;
}


/** Headlines about shares, IPOs, revenue, acquisitions, or VC funds raising money are not startup fundraising announcements. */
export const NOT_A_RAISE =
  /\bshares?\b|\bstake\b|bulk deal|\bipo[- ]?(opens?|subscri\w*|price|listing|allot\w*|gmp)\b|\b(files?|filed) (for )?(its )?ipo\b|market debut|\bacquires?\b|revenue|net loss|profit|fy\d\d|\bcorpus\b|\b(maiden|debut|new|first|second|third|venture|vc|deeptech|growth)\s+fund\b|\bfund\s+(i{1,3}|iv|v|vi|\d)\b|\bfor (its |a |an |the )?[\w ,-]{0,30}\bfund\b/i;
