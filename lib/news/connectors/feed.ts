// RSS 2.0 / RDF / Atom parsing for funding connectors. Tolerant, dependency-free.
// DATE RULE: only a PUBLICATION date is used (RSS pubDate, dc:date, Atom <published>). Atom <updated> and RSS lastBuildDate are
// "last modified" stamps: an old article that was edited yesterday must NOT look like a new funding round, so they are ignored.
import { stripHtml } from "@/lib/text";

export interface FeedItem { title: string; link: string; published: string | null; description: string }

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", nbsp: " ", ndash: "–", mdash: "—" };
export function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff))).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
const unwrap = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? unwrap(m[1]!) : null;
}

/** Date string from the publisher, or null. Unparsable, pre-2000 or implausibly future dates become null (never "now"). */
export function parseFeedDate(raw: string | null | undefined, now = Date.now()): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  if (!Number.isFinite(t) || new Date(t).getUTCFullYear() < 2000 || t > now + 2 * 86_400_000) return null;
  return new Date(t).toISOString();
}
/** Connector items older than this are not "new funding news", whatever the feed says. */
export const MAX_NEWS_AGE_DAYS = 180;
export const isTooOld = (iso: string | null, now = Date.now(), maxDays = MAX_NEWS_AGE_DAYS) => !!iso && now - Date.parse(iso) > maxDays * 86_400_000;

export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const it = m[0];
    const title = decodeEntities(stripHtml(tag(it, "title") ?? ""));
    const link = decodeEntities((tag(it, "link") ?? tag(it, "guid") ?? "").trim());
    if (!title || !/^https?:\/\//i.test(link)) continue;
    items.push({ title, link, published: tag(it, "pubDate") ?? tag(it, "dc:date"), description: stripHtml(decodeEntities(tag(it, "description") ?? tag(it, "content:encoded") ?? "")).slice(0, 600) });
  }
  for (const m of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
    const e = m[0];
    const title = decodeEntities(stripHtml(tag(e, "title") ?? ""));
    const links = [...e.matchAll(/<link\b([^>]*?)\/?>/gi)].map((l) => ({ rel: /rel=["']([^"']+)["']/i.exec(l[1]!)?.[1] ?? "alternate", href: /href=["']([^"']+)["']/i.exec(l[1]!)?.[1] ?? "" }));
    const link = decodeEntities((links.find((l) => l.rel === "alternate") ?? links[0])?.href ?? "");
    if (!title || !/^https?:\/\//i.test(link)) continue;
    items.push({ title, link, published: tag(e, "published"), description: stripHtml(decodeEntities(tag(e, "summary") ?? tag(e, "content") ?? "")).slice(0, 600) });
  }
  return items;
}
export const looksLikeFeed = (body: string) => /<(rss|feed|rdf:RDF)\b/i.test(body);
