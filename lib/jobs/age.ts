// Posting-date logic. Two different dates are NEVER mixed up here:
//   posted date   - what the SOURCE said (exact, or approximate when it only said "3 days ago")
//   first seen    - when Jyntra first found the listing (discovered_at); says nothing about when it was posted
// A first-seen date is shown as a first-seen date. It is never used as a stand-in for the posting date.
import { settings } from "@/config/settings";

const UNIT_DAYS: Record<string, number> = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
const DAY_MS = 86_400_000;

const daysBetween = (from: Date | string, to: Date) => Math.max(0, (to.getTime() - new Date(from).getTime()) / DAY_MS);

/**
 * Age in days from the source's date text ("2026-09-30", "3 days ago", "over 2 years ago"), or null when it gave none.
 * `textAsOf`: when a relative text was read. Stored legacy rows keep the text from the day they were found, so that
 * time is added back.
 */
export function jobAgeDays(posted: string | null | undefined, now = new Date(), textAsOf?: Date | string | null): number | null {
  if (!posted) return null;
  const since = textAsOf ? daysBetween(textAsOf, now) : 0;
  const rel = posted.match(/\b(\d+|an?)\s+(minute|hour|day|week|month|year)s?\b/i);
  if (rel && /ago/i.test(posted)) {
    const n = /^an?$/i.test(rel[1]) ? 1 : parseInt(rel[1], 10);
    return n * UNIT_DAYS[rel[2].toLowerCase()] + since;
  }
  if (/less than a minute|just now|today/i.test(posted)) return since;
  const d = new Date(posted);
  return isNaN(d.getTime()) ? null : daysBetween(d, now);
}

/**
 * Ingestion guard: a DATED posting older than settings.maxListedJobAgeDays is not stored. Undated postings are kept
 * (the source still lists them); they are labelled "date not provided" and never counted as newly posted.
 */
export function isJobBeyondListedWindow(posted: string | null | undefined, now = new Date()): boolean {
  const age = jobAgeDays(posted, now);
  return age !== null && age > settings.maxListedJobAgeDays;
}

export type RecencyBucket = "new" | "newly_found" | "older";
export type DateBasis = "exact" | "approx" | "none";

export interface JobRecency {
  bucket: RecencyBucket;
  /** Age from the SOURCE's posting date; null when the source gave none. */
  posted_age_days: number | null;
  /** Days since Jyntra first saw the listing. Not a posting age. */
  first_seen_age_days: number;
  date_basis: DateBasis;
  /** Whole sentence for the card, e.g. "Posted 3 days ago (source date, approximate)". */
  label: string;
  /** The source has not re-confirmed the listing recently (source failing, or listing removed upstream but not yet swept). */
  recheck_overdue: boolean;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
function agoText(days: number) {
  if (days < 1) return "today";
  const d = Math.floor(days);
  if (d < 60) return `${plural(d, "day")} ago`;
  return `${plural(Math.floor(d / 30), "month")} ago`;
}

export interface RecencyInput {
  posted_date: string | null;
  posted_precision?: "exact" | "approx" | null;
  discovered_at: string | Date;
  last_checked_at?: string | Date | null;
}

export function jobRecency(j: RecencyInput, now = new Date()): JobRecency {
  const firstSeen = daysBetween(j.discovered_at, now);
  // Legacy rows may hold relative text; they are aged from the day they were first read.
  const posted = jobAgeDays(j.posted_date, now, j.discovered_at);
  const isIso = !!j.posted_date && /^\d{4}-\d{2}-\d{2}/.test(j.posted_date);
  const basis: DateBasis = posted === null ? "none" : j.posted_precision === "approx" || !isIso ? "approx" : "exact";
  const recheck = j.last_checked_at ? daysBetween(j.last_checked_at, now) * 24 > settings.listingRecheckHours : false;

  let bucket: RecencyBucket;
  let label: string;
  if (posted !== null) {
    bucket = posted <= settings.newJobDays ? "new" : "older";
    label = `Posted ${agoText(posted)} (${basis === "exact" ? "date from the source" : "source gave a relative date, so this is approximate"})`;
  } else {
    bucket = firstSeen <= settings.newJobDays ? "newly_found" : "older";
    label = `Posting date not provided. First seen by Jyntra ${agoText(firstSeen)}`;
  }
  return { bucket, posted_age_days: posted, first_seen_age_days: firstSeen, date_basis: basis, label, recheck_overdue: recheck };
}

/** Discover → Posted filter. */
export type PostedWindow = "week" | "confirmed_week" | "any";
export const POSTED_WINDOWS: { value: PostedWindow; label: string; help: string }[] = [
  { value: "week", label: "New this week", help: `Posted in the last ${settings.newJobDays} days, plus listings first found this week whose source gives no posting date (labelled).` },
  { value: "confirmed_week", label: "Posted this week (dated)", help: `Only listings whose source gives a posting date within ${settings.newJobDays} days.` },
  { value: "any", label: "Any date, still listed", help: "Every listing the source still shows, including older roles." },
];

export function inPostedWindow(r: JobRecency, w: PostedWindow): boolean {
  if (w === "any") return true;
  if (w === "confirmed_week") return r.bucket === "new";
  return r.bucket === "new" || r.bucket === "newly_found";
}

/**
 * Sort key for "Newest": confirmed posting date first (youngest first), then listings with no posting date
 * (most recently first seen). A first-seen age is never compared as if it were a posting age.
 */
export function newestOrder(a: JobRecency, b: JobRecency): number {
  const ap = a.posted_age_days, bp = b.posted_age_days;
  if (ap !== null && bp !== null) return ap - bp;
  if (ap !== null) return -1;
  if (bp !== null) return 1;
  return a.first_seen_age_days - b.first_seen_age_days;
}
