// One place that turns whatever a source returned into the internal shape.
// Rule: a value is either stated by the source or it is null. Nothing is guessed or filled in.
import { canonicalUrl } from "@/lib/url";
import type { JobResult } from "@/lib/types";

const DAY = 86_400_000;
const UNIT_MS: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };

export type DatePrecision = "exact" | "approx";

/**
 * Turns a source's date text into an absolute ISO date.
 *  - "2026-09-30" / "2026-09-30T10:00:00Z"  → exact
 *  - "3 days ago", "about 1 month ago"      → approx, counted back from `fetchedAt` (when WE saw it)
 *  - anything else                          → null (unknown)
 * Relative text must be converted at ingestion: stored as text it silently drifts ("3 days ago" forever).
 */
export function parsePostedDate(raw: string | null | undefined, fetchedAt = new Date()): { date: string | null; precision: DatePrecision | null } {
  const s = (raw ?? "").trim();
  if (!s) return { date: null, precision: null };
  if (/^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? { date: null, precision: null } : { date: d.toISOString().slice(0, 10), precision: "exact" };
  }
  if (/less than a minute|just now|\btoday\b/i.test(s)) return { date: fetchedAt.toISOString().slice(0, 10), precision: "approx" };
  const rel = s.match(/\b(\d+|an?)\s+(minute|hour|day|week|month|year)s?\b/i);
  if (rel && /ago/i.test(s)) {
    const n = /^an?$/i.test(rel[1]) ? 1 : parseInt(rel[1], 10);
    return { date: new Date(fetchedAt.getTime() - n * UNIT_MS[rel[2].toLowerCase()]).toISOString().slice(0, 10), precision: "approx" };
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2000) return { date: d.toISOString().slice(0, 10), precision: "exact" };
  return { date: null, precision: null };
}

const EMPLOYMENT: [RegExp, string][] = [
  [/full[\s_-]*time|permanent/i, "Full-time"],
  [/part[\s_-]*time/i, "Part-time"],
  [/contract|freelance/i, "Contract"],
  [/intern/i, "Internship"],
  [/temp/i, "Temporary"],
];
/** Canonical employment type when recognisable, otherwise the source's own wording (trimmed). */
export function normalizeEmploymentType(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return EMPLOYMENT.find(([re]) => re.test(s))?.[1] ?? s.slice(0, 40);
}

/** Currency is reported only when the text contains an unambiguous symbol or code. "5M" alone has no currency. */
export function detectCurrency(text: string | null | undefined): "INR" | "USD" | "EUR" | "GBP" | null {
  const s = text ?? "";
  if (/₹|\bINR\b|\bRs\.?\s?\d|\bCr\b|\bcrore\b|\blakh\b/i.test(s)) return "INR";
  if (/€|\bEUR\b/i.test(s)) return "EUR";
  if (/£|\bGBP\b/i.test(s)) return "GBP";
  if (/\$|\bUSD\b/i.test(s)) return "USD";
  return null;
}

const clean = (s: string | null | undefined, max: number) => {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
};

export interface NormalizedJob extends Omit<JobResult, "postedDate"> {
  canonicalUrl: string;
  externalId: string | null;
  /** ISO date or null. */
  postedDate: string | null;
  postedPrecision: DatePrecision | null;
  verification: string | null;
}

/** Returns null when the record has no usable title or URL (it is dropped, not repaired). */
export function normalizeJob(j: JobResult, fetchedAt = new Date()): NormalizedJob | null {
  const title = clean(j.title, 200);
  const canon = canonicalUrl(j.url);
  if (!title || !canon) return null;
  const posted = parsePostedDate(j.postedDate, fetchedAt);
  const seen = new Set<string>();
  const skills = (j.skills ?? [])
    .map((x) => clean(x, 40))
    .filter((x): x is string => !!x && !seen.has(x.toLowerCase()) && !!seen.add(x.toLowerCase()))
    .slice(0, 30);
  return {
    ...j,
    title,
    url: canon,
    canonicalUrl: canon,
    applyUrl: canonicalUrl(j.applyUrl),
    location: clean(j.location, 200),
    employmentType: normalizeEmploymentType(j.employmentType),
    minExperience: clean(j.minExperience, 60),
    salary: clean(j.salary, 120), // only what the source printed; never estimated
    skills,
    description: j.description ? j.description.trim().slice(0, 2500) : null,
    externalId: clean(j.externalId, 200),
    postedDate: posted.date,
    postedPrecision: posted.precision,
    verification: j.verification ?? null,
  };
}

/** Lower-cased, punctuation-free, legal-suffix-free name used for company matching. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(private|pvt|limited|ltd|llc|inc|incorporated|corp|corporation|technologies|technology|labs|co)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Registrable-ish domain: lower-case host without www. Not a public-suffix lookup, by design (see lib/url). */
export function normalizeDomain(site: string | null | undefined): string | null {
  const c = canonicalUrl(site);
  if (!c) return null;
  try {
    return new URL(c).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
