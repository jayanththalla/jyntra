// `npm run jobs:sync-cities`: fetch jobs from EVERY validated employer board and keep the Bengaluru / Hyderabad / Chennai /
// India-remote slice of them current. One employer board may publish jobs in several cities, so nothing here needs a
// city-specific board. A failed source keeps its previous jobs (runSource never closes anything on failure).
import { KeyedLimiter } from "./limiter";
import { getProvider } from "./providers";
import { runSource } from "./runner";
import { hostKeyOf, hostLimitKeys, ingestionConcurrency, PROVIDER_LIMITS } from "./scheduler";
import { claimSourcesNow, releaseLeases, toJobSource, type SourceRow } from "./source-store";
import { IngestError, type NormalizedJob } from "./types";
import { query } from "@/lib/database";

export type CityFilter = "bengaluru" | "hyderabad" | "chennai" | "india_remote" | "all";
export const CITY_FILTERS: CityFilter[] = ["bengaluru", "hyderabad", "chennai", "india_remote", "all"];

export interface CityBucket { companies: number; jobs: number; missingApplyUrl: number; sample: { company: string; title: string; locations: string[]; applyUrl: string | null }[] }
export interface SyncCitiesReport {
  dryRun: boolean; city: CityFilter; startedAt: string; durationMs: number;
  sources: { loaded: number; succeeded: number; incomplete: number; failed: number; failures: Record<string, number> };
  jobsFetched: number; duplicatesInPayloads: number;
  perCity: Record<"bengaluru" | "hyderabad" | "chennai" | "india_remote", CityBucket>;
  perProvider: Record<string, { sources: number; failed: number; jobs: number; bengaluru: number; hyderabad: number; chennai: number; india_remote: number }>;
  db?: { inserted: number; updated: number; closed: number; unchanged: number };
}

const bucket = (): CityBucket => ({ companies: 0, jobs: 0, missingApplyUrl: 0, sample: [] });
const CITIES = ["bengaluru", "hyderabad", "chennai", "india_remote"] as const;

export async function syncCities(o: { city?: CityFilter; dryRun?: boolean; provider?: string | null; limit?: number | null; concurrency?: number; onlyKnownCity?: boolean; signal?: AbortSignal; sampleSize?: number } = {}): Promise<SyncCitiesReport> {
  const t0 = Date.now();
  const city = o.city ?? "all";
  const rep: SyncCitiesReport = {
    dryRun: !!o.dryRun, city, startedAt: new Date().toISOString(), durationMs: 0,
    sources: { loaded: 0, succeeded: 0, incomplete: 0, failed: 0, failures: {} }, jobsFetched: 0, duplicatesInPayloads: 0,
    perCity: { bengaluru: bucket(), hyderabad: bucket(), chennai: bucket(), india_remote: bucket() }, perProvider: {},
    db: o.dryRun ? undefined : { inserted: 0, updated: 0, closed: 0, unchanged: 0 },
  };
  // Dry run: read-only listing, no leases, no writes. Real run: lease-claimed so the worker and this command never overlap on a board.
  const rows: SourceRow[] = o.dryRun
    ? await query<SourceRow>("SELECT * FROM job_sources WHERE status IN ('active','failing') AND ($1::text IS NULL OR provider=$1) ORDER BY id LIMIT $2", [o.provider ?? null, o.limit ?? 100000])
    : await claimSourcesNow({ limit: o.limit ?? undefined, provider: o.provider, onlyCity: o.onlyKnownCity && city !== "all" && city !== "india_remote" ? city : null });
  rep.sources.loaded = rows.length;
  const companiesIn: Record<string, Set<string>> = { bengaluru: new Set(), hyderabad: new Set(), chennai: new Set(), india_remote: new Set() };
  const global = new KeyedLimiter(o.concurrency ?? ingestionConcurrency());
  const byProvider = new KeyedLimiter(3, PROVIDER_LIMITS);
  const byHost = new KeyedLimiter(1);
  const pending = new Set(rows.map((r) => r.id));
  const sample = o.sampleSize ?? 5;

  const tallyJobs = (row: SourceRow, jobs: NormalizedJob[]) => {
    const pp = (rep.perProvider[row.provider] ??= { sources: 0, failed: 0, jobs: 0, bengaluru: 0, hyderabad: 0, chennai: 0, india_remote: 0 });
    const ids = new Set<string>();
    for (const j of jobs) {
      if (ids.has(j.externalJobId)) { rep.duplicatesInPayloads++; continue; }
      ids.add(j.externalJobId);
      rep.jobsFetched++; pp.jobs++;
      const hit: (typeof CITIES[number])[] = [...j.cities, ...(j.cityClass === "india_remote" ? ["india_remote" as const] : [])];
      for (const c of hit) {
        const b = rep.perCity[c];
        b.jobs++; pp[c]++;
        if (!j.applyUrl) b.missingApplyUrl++;
        companiesIn[c]!.add(row.company_slug);
        if (b.sample.length < sample) b.sample.push({ company: row.company_slug, title: j.title, locations: j.locations, applyUrl: j.applyUrl });
      }
    }
  };

  await Promise.all(rows.map((row) => global.run(["all"], () => byProvider.run([`p:${row.provider}`], () => byHost.run(hostLimitKeys(row.provider, hostKeyOf(row)), async () => {
    if (o.signal?.aborted) return;
    const pp = (rep.perProvider[row.provider] ??= { sources: 0, failed: 0, jobs: 0, bengaluru: 0, hyderabad: 0, chennai: 0, india_remote: 0 });
    pp.sources++;
    if (o.dryRun) {
      try {
        const res = await getProvider(row.provider).fetchJobs(toJobSource(row), { signal: o.signal });
        res.complete ? rep.sources.succeeded++ : rep.sources.incomplete++;
        tallyJobs(row, res.jobs);
      } catch (e) {
        const cat = e instanceof IngestError ? e.category : "network";
        rep.sources.failed++; pp.failed++; rep.sources.failures[cat] = (rep.sources.failures[cat] ?? 0) + 1;
      }
      return;
    }
    const out = await runSource(row.id, { signal: o.signal });
    pending.delete(row.id);
    if (out.status === "failed") { rep.sources.failed++; pp.failed++; rep.sources.failures[out.category ?? "network"] = (rep.sources.failures[out.category ?? "network"] ?? 0) + 1; }
    else if (out.status === "partial") rep.sources.incomplete++;
    else if (out.status === "success" || out.status === "not_modified") rep.sources.succeeded++;
    rep.jobsFetched += out.fetched; pp.jobs += out.fetched;
    if (out.stats && rep.db) { rep.db.inserted += out.stats.inserted; rep.db.updated += out.stats.updated; rep.db.closed += out.stats.closed; rep.db.unchanged += out.stats.unchanged; }
  })))));
  if (!o.dryRun) await releaseLeases([...pending]);

  if (o.dryRun) {
    for (const c of CITIES) rep.perCity[c].companies = companiesIn[c]!.size;
  } else {
    // Real run: every per-city number comes from the database after the upserts, not from in-flight counters.
    const rows2 = await query<{ c: string; companies: string; jobs: string; missing: string }>(
      `SELECT c, count(DISTINCT company_slug)::text companies, count(*)::text jobs, count(*) FILTER (WHERE application_url IS NULL)::text missing FROM (
         SELECT unnest(cities) c, company_slug, application_url FROM company_jobs WHERE is_active AND source_id IS NOT NULL
         UNION ALL SELECT 'india_remote', company_slug, application_url FROM company_jobs WHERE is_active AND source_id IS NOT NULL AND city_class='india_remote') x GROUP BY c`);
    for (const r of rows2) if ((CITIES as readonly string[]).includes(r.c)) Object.assign(rep.perCity[r.c as typeof CITIES[number]], { companies: Number(r.companies), jobs: Number(r.jobs), missingApplyUrl: Number(r.missing) });
    for (const c of CITIES) {
      rep.perCity[c].sample = await query<any>(
        `SELECT j.company_slug company, j.title, j.locations, j.application_url "applyUrl" FROM company_jobs j WHERE j.is_active AND j.source_id IS NOT NULL AND ${c === "india_remote" ? "j.city_class='india_remote'" : "$1 = ANY(j.cities)"} ORDER BY j.last_seen_at DESC LIMIT ${sample}`, c === "india_remote" ? [] : [c]);
    }
  }
  rep.durationMs = Date.now() - t0;
  return rep;
}
