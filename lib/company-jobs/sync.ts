// Scheduled company-job discovery. Never runs as a side-effect of opening the Companies page.
import fs from "node:fs";
import path from "node:path";
import { FetchError, errorCategory, politeFetch, retryDelayMs } from "@/lib/http";
import { withAdvisoryLock } from "@/lib/refresh/lock";
import { recordSourceRun } from "@/lib/refresh/health";
import { countInvalidApplyUrls, mapCompanyApiJobs, mergeJobLists, nextPageFromBody, type CompanyJobRecord } from "./adapter";
import { jobsFromPublicAts } from "./alt-sources";
import { findAtsRef } from "@/sources/jobs/ats";
import { prettyName } from "@/sources/jobs/blrarena";
import {
  listJobsForSlug,
  markCompanyJobsStale,
  persistCompanyJobs,
  recordCompanyFetch,
  saveSyncRun,
  trustedWebsiteFor,
  upsertCompanyProfile,
} from "./store";
import { query } from "@/lib/database";

const BASE = process.env.BLRARENA_BASE_URL || "https://www.blrstartuparena.com";
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const MAX_PAGES = 20;

export function companyJobsConcurrency(env = process.env): number {
  const n = Number(env.COMPANY_JOBS_CONCURRENCY ?? 3);
  return Number.isFinite(n) ? Math.min(8, Math.max(1, Math.floor(n))) : 3;
}

export function knownCompanySlugs(env = process.env): string[] {
  const out = new Set<string>();
  for (const s of (env.BLRARENA_COMPANY_SLUGS ?? "").split(",")) out.add(s.trim().toLowerCase());
  try {
    for (const s of fs.readFileSync(path.join(process.cwd(), "data", "blrarena-slugs.txt"), "utf8").split(/\r?\n/)) {
      out.add(s.trim().toLowerCase());
    }
  } catch {
    /* optional */
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "blrarena-jobs.json"), "utf8")) as { jobs?: { slug?: string }[] };
    for (const j of raw.jobs ?? []) if (j.slug) out.add(String(j.slug).toLowerCase());
  } catch {
    /* optional */
  }
  return [...out].filter((s) => SLUG.test(s));
}

export interface CompanySyncStats {
  companies: number;
  companiesOk: number;
  jobsFetched: number;
  inserted: number;
  updated: number;
  recovered: number;
  missingApplicationLinks: number;
  invalidLinks: number;
  failures: Record<string, number>;
  httpStatus: Record<string, number>;
  lastSuccessAt: string | null;
  overlappingSkipped: boolean;
}

const emptyStats = (): CompanySyncStats => ({
  companies: 0,
  companiesOk: 0,
  jobsFetched: 0,
  inserted: 0,
  updated: 0,
  recovered: 0,
  missingApplicationLinks: 0,
  invalidLinks: 0,
  failures: {},
  httpStatus: {},
  lastSuccessAt: null,
  overlappingSkipped: false,
});

async function fetchJobsJson(slug: string): Promise<{ ok: true; body: unknown; status: number } | { ok: false; status: number; category: string; error: string }> {
  let lastStatus = 0;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await politeFetch(`${BASE}/api/companies/${slug}/jobs`, { headers: { Accept: "application/json" } });
      lastStatus = res.status;
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return { ok: false, status: res.status, category: "bad_response", error: "response was not JSON" };
      }
      return { ok: true, body, status: res.status };
    } catch (e) {
      const status = e instanceof FetchError ? e.status ?? 0 : 0;
      lastStatus = status || lastStatus;
      if (status === 404) return { ok: false, status: 404, category: "client_error", error: "not found" };
      if (attempt < 2) await new Promise((r) => setTimeout(r, retryDelayMs(attempt, e instanceof FetchError ? String(e.retryAfterSeconds ?? "") : null)));
      else return { ok: false, status, category: errorCategory(e), error: (e as Error).message.slice(0, 200) };
    }
  }
  return { ok: false, status: lastStatus, category: "network", error: "fetch failed" };
}

async function collectPages(slug: string, first: unknown): Promise<{ jobs: CompanyJobRecord[]; complete: boolean; invalid: number }> {
  const companyPage = `${BASE}/companies/${slug}`;
  const page = mapCompanyApiJobs(first, slug, { companyPage: `${BASE}/companies/${slug}`, source: "blrarena" });
  if ("error" in page) return { jobs: [], complete: false, invalid: 0 };
  const jobs = [...page.jobs];
  let invalid = countInvalidApplyUrls(first, slug, companyPage);
  let next = nextPageFromBody(first, 1);
  let n = 1;
  while (next && n < MAX_PAGES) {
    n++;
    const url = `${BASE}/api/companies/${slug}/jobs?page=${next}`;
    try {
      const res = await politeFetch(url, { headers: { Accept: "application/json" } });
      const body = JSON.parse(await res.text());
      const mapped = mapCompanyApiJobs(body, slug, { companyPage: `${BASE}/companies/${slug}`, source: "blrarena" });
      if ("error" in mapped) return { jobs, complete: false, invalid };
      jobs.push(...mapped.jobs);
      invalid += countInvalidApplyUrls(body, slug, companyPage);
      next = nextPageFromBody(body, next);
    } catch {
      return { jobs, complete: false, invalid };
    }
  }
  return { jobs, complete: true, invalid };
}

async function altJobs(slug: string, name: string): Promise<CompanyJobRecord[]> {
  const site = await trustedWebsiteFor(slug, name).catch(() => null);
  if (!site) return [];
  const ref = findAtsRef(site);
  if (!ref) return [];
  try {
    return await jobsFromPublicAts(ref, slug);
  } catch {
    return [];
  }
}

export async function syncOneCompany(slug: string): Promise<{ ok: boolean; inserted: number; updated: number; fetched: number; missing: number; invalid: number; recovered?: number; category?: string; status?: number }> {
  const name = prettyName(slug);
  await upsertCompanyProfile(slug, name);
  const got = await fetchJobsJson(slug);
  if (!got.ok) {
    if (got.status === 404) {
      const alt = await altJobs(slug, name);
      if (alt.length) {
        const r = await persistCompanyJobs(slug, alt, { complete: true, source: alt[0].source });
        await recordCompanyFetch(slug, { ok: true, httpStatus: 404 });
        return { ok: true, inserted: r.inserted, updated: r.updated, fetched: alt.length, missing: alt.filter((j) => !j.applicationUrl).length, invalid: 0, status: 404 };
      }
      await recordCompanyFetch(slug, { ok: true, httpStatus: 404 });
      return { ok: true, inserted: 0, updated: 0, fetched: 0, missing: 0, invalid: 0, status: 404 };
    }
    await markCompanyJobsStale(slug, "blrarena");
    await recordCompanyFetch(slug, { ok: false, stale: true, error: got.error, category: got.category, httpStatus: got.status || null });
    return { ok: false, inserted: 0, updated: 0, fetched: 0, missing: 0, invalid: 0, category: got.category, status: got.status };
  }
  const parsed = mapCompanyApiJobs(got.body, slug, { companyPage: `${BASE}/companies/${slug}`, source: "blrarena" });
  if ("error" in parsed) {
    await markCompanyJobsStale(slug, "blrarena");
    await recordCompanyFetch(slug, { ok: false, stale: true, error: parsed.error, category: "bad_response", httpStatus: got.status });
    return { ok: false, inserted: 0, updated: 0, fetched: 0, missing: 0, invalid: 0, category: "bad_response", status: got.status };
  }
  const pages = await collectPages(slug, got.body);
  let jobs = pages.jobs;
  if (!jobs.length) {
    const alt = await altJobs(slug, name);
    jobs = mergeJobLists(jobs, alt).merged;
  } else {
    const existing = await listJobsForSlug(slug).catch(() => []);
    jobs = mergeJobLists(existing.filter((e) => e.source !== "blrarena"), jobs).merged;
  }
  const r = await persistCompanyJobs(slug, jobs, { complete: pages.complete, source: "blrarena" });
  await recordCompanyFetch(slug, { ok: true, httpStatus: got.status });
  const missing = jobs.filter((j) => !j.applicationUrl).length;
  return { ok: true, inserted: r.inserted, updated: r.updated, fetched: jobs.length, missing, invalid: pages.invalid, recovered: r.recovered, status: got.status };
}

const RECOVERY_COOLDOWN_MS = 6 * 3600_000;
const recovering = new Map<string, Promise<CompanyJobRecord[]>>();

/**
 * Link recovery for one company, used when its jobs have no application URL. Asks the public jobs endpoint again
 * (one request, at most once per cooldown per company) and stores any real links it returns. If the database is
 * unavailable it maps the live response in memory instead. Nothing is ever invented.
 */
export function recoverCompanyLinks(slug: string): Promise<CompanyJobRecord[]> {
  const running = recovering.get(slug);
  if (running) return running;
  const p = (async () => {
    try {
      const [p0] = await query<{ last: string | null }>("SELECT last_jobs_fetch_at::text AS last FROM company_profiles WHERE slug=$1", [slug]);
      const recent = p0?.last && Date.now() - Date.parse(p0.last) < RECOVERY_COOLDOWN_MS;
      if (!recent) await syncOneCompany(slug);
      return await listJobsForSlug(slug);
    } catch {
      const got = await fetchJobsJson(slug);
      if (!got.ok) return [];
      const mapped = mapCompanyApiJobs(got.body, slug, { companyPage: `${BASE}/companies/${slug}`, source: "blrarena" });
      return "error" in mapped ? [] : mapped.jobs;
    }
  })().finally(() => recovering.delete(slug));
  recovering.set(slug, p);
  return p;
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item);
      }
    })
  );
}

const g = globalThis as unknown as { __companyJobSync?: boolean };
export function startCompanyJobSync(): boolean {
  if (g.__companyJobSync) return false;
  g.__companyJobSync = true;
  syncCompanyJobs()
    .catch((e) => console.error("[company-jobs] sync failed:", (e as Error).message))
    .finally(() => {
      g.__companyJobSync = false;
    });
  return true;
}

export async function syncCompanyJobs(opts: { slugs?: string[]; limit?: number } = {}): Promise<{ ran: boolean; stats: CompanySyncStats }> {
  const stats = emptyStats();
  const locked = await withAdvisoryLock("company-jobs-sync", async () => {
    const slugs = (opts.slugs ?? knownCompanySlugs()).slice(0, opts.limit ?? 5000);
    stats.companies = slugs.length;
    const t0 = Date.now();
    await runPool(slugs, companyJobsConcurrency(), async (slug) => {
      const r = await syncOneCompany(slug);
      if (r.ok) {
        stats.companiesOk++;
        stats.jobsFetched += r.fetched;
        stats.inserted += r.inserted;
        stats.updated += r.updated;
        stats.missingApplicationLinks += r.missing;
        stats.invalidLinks += r.invalid;
        stats.recovered += r.recovered ?? 0;
        stats.lastSuccessAt = new Date().toISOString();
      } else {
        stats.failures[r.category ?? "network"] = (stats.failures[r.category ?? "network"] ?? 0) + 1;
      }
      const bucket = r.status && r.status >= 500 ? "5xx" : r.status && r.status >= 400 ? "4xx" : r.status && r.status >= 200 ? "2xx" : "other";
      stats.httpStatus[bucket] = (stats.httpStatus[bucket] ?? 0) + 1;
    });
    await saveSyncRun(stats).catch(() => {});
    await recordSourceRun("blrarena", {
      ok: stats.companiesOk > 0,
      note: `${stats.companiesOk}/${stats.companies} companies, ${stats.jobsFetched} jobs`,
      error: stats.companiesOk ? undefined : "no company jobs could be read",
      category: stats.companiesOk ? undefined : "network",
      durationMs: Date.now() - t0,
    }).catch(() => {});
    return stats;
  });
  if (!locked.ran) {
    stats.overlappingSkipped = true;
    return { ran: false, stats };
  }
  return { ran: true, stats: locked.value };
}

export async function companyJobDiagnostics() {
  const last = await query<{ started_at: string; finished_at: string | null; stats: CompanySyncStats }>(
    "SELECT started_at, finished_at, stats FROM company_job_sync_runs ORDER BY id DESC LIMIT 1"
  ).catch(() => []);
  const counts = await query<{ c: string; valid: string; missing: string; invalid: string }>(
    `SELECT count(*)::text c,
            count(*) FILTER (WHERE application_url IS NOT NULL AND canonical_application_url IS NOT NULL)::text valid,
            count(*) FILTER (WHERE application_url IS NULL)::text missing,
            count(*) FILTER (WHERE application_url IS NOT NULL AND canonical_application_url IS NULL)::text invalid
     FROM company_jobs WHERE is_active`
  ).catch(() => [{ c: "0", valid: "0", missing: "0", invalid: "0" }]);
  const companies = await query<{ ok: string }>(
    `SELECT count(*) FILTER (WHERE last_jobs_success_at IS NOT NULL)::text ok FROM company_profiles`
  ).catch(() => [{ ok: "0" }]);
  const logos = await query<{ resolved: string; initials: string; failed: string }>(
    `SELECT count(*) FILTER (WHERE logo_status='resolved')::text resolved,
            count(*) FILTER (WHERE logo_status='initials')::text initials,
            count(*) FILTER (WHERE logo_status='failed')::text failed
     FROM company_profiles`
  ).catch(() => [{ resolved: "0", initials: "0", failed: "0" }]);
  const run = last[0];
  const next = run?.started_at ? new Date(new Date(run.started_at).getTime() + 6 * 3600_000).toISOString() : null;
  return {
    companies_synced: Number(companies[0]?.ok ?? 0),
    logos: { resolved: Number(logos[0]?.resolved ?? 0), initials: Number(logos[0]?.initials ?? 0), failed: Number(logos[0]?.failed ?? 0) },
    jobs_fetched: Number(counts[0]?.c ?? 0),
    new_records: run?.stats?.inserted ?? null,
    updated_records: run?.stats?.updated ?? null,
    valid_application_links: Number(counts[0]?.valid ?? 0),
    missing_application_links: Number(counts[0]?.missing ?? 0),
    invalid_links: Number(counts[0]?.invalid ?? 0) + Number(run?.stats?.invalidLinks ?? 0),
    recovered_links: run?.stats?.recovered ?? 0,
    provider_failures: run?.stats?.failures ?? {},
    http_status: run?.stats?.httpStatus ?? {},
    last_successful_sync: run?.stats?.lastSuccessAt ?? run?.finished_at ?? null,
    next_scheduled_sync: next,
    overlapping_skipped: run?.stats?.overlappingSkipped ?? false,
  };
}
