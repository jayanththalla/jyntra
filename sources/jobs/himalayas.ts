// Himalayas public jobs API, documented at https://himalayas.app/api (read 2026-10-29).
//   GET https://himalayas.app/jobs/api/search?country=India&sort=recent&page=N   (page is 1-based; keep going until a page has no jobs)
//   Response: { jobs: [{ title, companyName, locationRestrictions, pubDate (unix seconds), expiryDate (unix seconds),
//               applicationLink, guid (job page on Himalayas), ... }] }
// Terms that shape this adapter: call it from the server only (no CORS); use applicationLink unchanged for Apply; link to the job
// on Himalayas as the source; remove jobs once they expire; do not pass jobs on to other boards. Data refreshes daily, so polling
// more than about hourly gains nothing. Over the limit the API answers 429 (with Retry-After when a key is used).
// This is the provider's documented API, so robots.txt (which governs crawlers) is not applied to it.
// Like any job board, it only adds jobs to startups we already track (see fundedRecentlyEnough).
import type { DiscoveryContext, JobResult, StartupResult, StartupSource } from "@/lib/types";
import { FetchError, cachedTextInfo, errorCategory } from "@/lib/http";
import { himalayasEnabled } from "@/lib/providers/config";
import { stripHtml } from "@/lib/text";
import { isJobBeyondListedWindow } from "@/lib/jobs/age";
import { settings } from "@/config/settings";

const SEARCH = "https://himalayas.app/jobs/api/search";

export interface HimalayasJob {
  title: string;
  excerpt?: string;
  companyName: string;
  companySlug?: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string | null;
  seniority?: string[];
  locationRestrictions?: string[];
  categories?: string[];
  description?: string;
  pubDate: number; // unix seconds (last update time)
  expiryDate?: number | null; // unix seconds: the latest the job stays listed
  applicationLink?: string;
  guid: string; // job page on Himalayas
}

/** A Himalayas job → our job, or null if it's too old or not open to India. */
export function himalayasJob(j: HimalayasJob, now = new Date()): JobResult | null {
  const posted = j.pubDate ? new Date(j.pubDate * 1000).toISOString().slice(0, 10) : null;
  if (!j.guid || !j.title || isJobBeyondListedWindow(posted, now)) return null;
  // Himalayas' terms: remove jobs once they expire.
  if (j.expiryDate && j.expiryDate * 1000 < now.getTime()) return null;
  const places = j.locationRestrictions ?? [];
  const india = places.some((p) => /india/i.test(p));
  if (places.length && !india) return null; // restricted to other countries
  const salary =
    j.minSalary || j.maxSalary
      ? `${j.currency ?? ""} ${[j.minSalary, j.maxSalary].filter(Boolean).map((n) => n!.toLocaleString("en-US")).join("–")}`.trim()
      : null;
  return {
    title: j.title,
    url: j.guid,
    applyUrl: j.applicationLink || j.guid,
    location: india ? `Remote (${places.join(", ")})` : "Remote (Worldwide)",
    remote: "yes",
    remoteScope: india ? "India" : "Worldwide",
    employmentType: j.employmentType || null,
    postedDate: posted,
    // "Entry-level" etc. as stated by the employer; matching treats Entry-level as fresher-friendly.
    minExperience: j.seniority?.length ? j.seniority.join(", ") : null,
    salary,
    skills: (j.categories ?? []).map((c) => c.replace(/-/g, " ")),
    description: stripHtml([j.excerpt, j.description].filter(Boolean).join(" ")).slice(0, 2500),
    source: "himalayas",
    sourceUrl: j.guid,
  };
}

/** Validates and extracts one page. Throws on anything that is not the documented shape (an HTML error page, an error object, a bare array). */
export function parseHimalayasPage(body: string): HimalayasJob[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("response was not JSON");
  }
  const jobs = (data as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) throw new Error("response has no jobs array");
  return jobs.filter((j): j is HimalayasJob => !!j && typeof j === "object" && typeof (j as HimalayasJob).title === "string");
}

export interface PageResult {
  jobs: HimalayasJob[];
}
export type PageFetcher = (page: number) => Promise<PageResult>;

const defaultFetcher: PageFetcher = async (page) => {
  const url = `${SEARCH}?country=India&sort=recent&page=${page}`;
  // allowStale:false → a failed refresh is a failure, not "success with an old copy": the health record must stay honest.
  const r = await cachedTextInfo(url, settings.cacheHours.himalayas, { skipRobots: true, allowStale: false, validate: (b) => void parseHimalayasPage(b), headers: { Accept: "application/json" } });
  return { jobs: parseHimalayasPage(r.body) };
};

/**
 * Reads up to settings.himalayasPages pages. Failure rules:
 *  - page 1 fails → the whole source fails (so health shows it; stored jobs stay exactly as they were: nothing is closed);
 *  - a later page fails or rate-limits → keep what was read, stop (no hammering a rate-limited API), and mark every company's
 *    job list incomplete so missing postings are NOT treated as closed.
 */
export async function discoverHimalayas(ctx: Pick<DiscoveryContext, "log">, fetchPage: PageFetcher = defaultFetcher, maxPages = settings.himalayasPages): Promise<StartupResult[]> {
  const byCompany = new Map<string, StartupResult>();
  let seen = 0;
  let kept = 0;
  let complete = true;
  for (let page = 1; page <= maxPages; page++) {
    let jobs: HimalayasJob[];
    try {
      jobs = (await fetchPage(page)).jobs;
    } catch (e) {
      const cat = errorCategory(e);
      ctx.log(`Himalayas: page ${page} failed (${cat})`);
      // Nothing read at all is a source failure, not "no jobs today". Keep the original error so its category and Retry-After survive.
      if (page === 1) throw e instanceof FetchError ? e : new FetchError(`Himalayas could not be read (${(e as Error).message})`, undefined, cat);
      complete = false;
      break;
    }
    if (!jobs.length) break;
    seen += jobs.length;
    let fresh = 0;
    for (const j of jobs) {
      const job = himalayasJob(j);
      if (!job || !j.companyName?.trim()) continue;
      fresh++;
      kept++;
      const key = j.companyName.trim().toLowerCase();
      if (!byCompany.has(key)) byCompany.set(key, { name: j.companyName.trim(), source: "himalayas", sourceUrl: job.sourceUrl, jobs: [] });
      byCompany.get(key)!.jobs!.push(job);
    }
    if (!fresh) break; // sorted newest first: nothing recent left
  }
  if (!complete) for (const r of byCompany.values()) r.jobsComplete = false;
  ctx.log(`Himalayas: ${seen} jobs read, ${kept} recent and open to India, from ${byCompany.size} companies${complete ? "" : " (stopped early after an error; no postings were closed)"}.`);
  return [...byCompany.values()];
}

export const himalayasSource: StartupSource = {
  id: "himalayas",
  name: "Himalayas remote jobs",
  disabledReason: () => (himalayasEnabled() ? null : "turned off by HIMALAYAS_ENABLED=false"),
  discover: (ctx: DiscoveryContext) => discoverHimalayas(ctx),
};
