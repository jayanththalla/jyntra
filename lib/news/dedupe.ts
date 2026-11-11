// Funding-story de-duplication: same canonical URL, or near-identical headlines (token overlap).
import { canonicalUrl } from "@/lib/url";

export interface Story {
  title: string;
  link: string;
  snippet?: string;
  source: string;
  date?: string | null;
}

const STOP = new Set(["the", "a", "an", "in", "of", "to", "for", "and", "its", "at", "on", "with", "by", "from", "raises", "raised", "secures", "bags", "funding", "round"]);
const tokens = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9₹$ ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)));

export function headlineSimilarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Keeps one story per duplicate group (preferring a dated copy). Every URL seen in a group stays matched. */
export function dedupeStories<T extends Story>(items: T[], threshold = 0.7): T[] {
  const groups: { item: T; keys: Set<string>; titles: string[] }[] = [];
  for (const it of items) {
    const key = canonicalUrl(it.link) ?? it.link;
    const g = groups.find((x) => x.keys.has(key) || x.titles.some((t) => headlineSimilarity(t, it.title) >= threshold));
    if (!g) groups.push({ item: it, keys: new Set([key]), titles: [it.title] });
    else {
      g.keys.add(key);
      g.titles.push(it.title);
      if (!g.item.date && it.date) g.item = it;
    }
  }
  return groups.map((g) => g.item);
}

// ---- same RAISE reported by different outlets (different headlines, same facts) ----
// Rates are only for comparing two reports of one raise (20% tolerance); they are never shown or stored as a conversion.
const APPROX_PER_USD: Record<string, number> = { USD: 1, INR: 84, EUR: 0.92, GBP: 0.78 };
export const approxUsd = (value: number | null | undefined, currency: string | null | undefined): number | null =>
  value && currency && APPROX_PER_USD[currency] ? value / APPROX_PER_USD[currency] : null;

export interface RaiseFacts { company: string | null; usd: number | null; stage: string | null; at: string | null }

/**
 * Two reports describe the same raise when the company matches (case/punctuation-insensitive) AND the dates are within 45 days
 * (or unknown) AND either the amounts agree within 20% or, when an amount is missing, the stage agrees. Different stage = different round.
 */
export function sameRaise(a: RaiseFacts, b: RaiseFacts): boolean {
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!a.company || !b.company || norm(a.company) !== norm(b.company)) return false;
  if (a.at && b.at && Math.abs(new Date(a.at).getTime() - new Date(b.at).getTime()) > 45 * 86_400_000) return false;
  if (a.stage && b.stage && a.stage !== b.stage) return false;
  if (a.usd && b.usd) return Math.abs(a.usd - b.usd) / Math.max(a.usd, b.usd) <= 0.2;
  return !!a.stage && a.stage === b.stage;
}

export interface ExistingArticle {
  id: number;
  headline: string;
  company_name: string | null;
}

/**
 * Conservative near-duplicate check for stories with DIFFERENT URLs (e.g. the same raise in two outlets).
 * Both must clear a high headline-similarity bar, and if both name a company the names must agree.
 * Returns the existing article it most likely duplicates, or null (when unsure we keep both).
 */
export function findNearDuplicate(
  candidate: { headline: string; company_name: string | null },
  existing: ExistingArticle[],
  threshold = 0.85
): ExistingArticle | null {
  let best: { a: ExistingArticle; score: number } | null = null;
  for (const e of existing) {
    if (candidate.company_name && e.company_name && candidate.company_name.toLowerCase() !== e.company_name.toLowerCase()) continue;
    const score = headlineSimilarity(candidate.headline, e.headline);
    if (score >= threshold && (!best || score > best.score)) best = { a: e, score };
  }
  return best?.a ?? null;
}
