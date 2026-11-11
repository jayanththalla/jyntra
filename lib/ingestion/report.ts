// The admin ingestion report. EVERY number is computed from database rows (job_sources, company_jobs, discovery_candidates,
// source_validations, ingestion_runs, discovery_state) that were written by real ingestion/validation runs. Nothing is estimated,
// seeded or hard-coded; an empty database yields zeros.
import { query } from "@/lib/database";

const n = (v: unknown) => Number(v ?? 0);
export type CityKey = "bengaluru" | "hyderabad" | "chennai";

export interface CityReport { companiesWithActiveSources: number; companiesWithLiveJobs: number; activeJobs: number; jobsMissingApplicationUrl: number }
export interface IngestionReport {
  generatedAt: string;
  discovery: {
    candidatesDiscovered: number; boardsValidated: number; boardsRejected: number; boardsTemporarilyUnavailable: number; boardsAccessRestricted: number; unsupportedProviderBoards: number; notYetValidated: number;
    latestStatusByProvider: Record<string, Record<string, number>>; activeSources: number;
    unsupportedInventoryRows: { total: number; platforms: Record<string, number>; asOf: string | null };
  };
  cities: Record<CityKey, CityReport> & { indiaRemote: { companiesWithLiveJobs: number; activeJobs: number; jobsMissingApplicationUrl: number } };
  providerDistribution: { provider: string; sources: number; activeSources: number; activeJobs: number }[];
  refresh: { lastSuccessfulRefresh: string | null; sourcesCheckedLast24h: number; runsLast24h: number };
  sourceFailures: { total: number; byCategory: Record<string, number>; worst: { sourceId: number; company: string; provider: string; failures: number; category: string | null; error: string | null }[] };
  staleSources: { count: number; oldest: { sourceId: number; company: string; provider: string; lastSuccessAt: string | null }[] };
  duplicates: { duplicateRecordsDroppedFromPayloads: number; activeJobsSharingAnApplicationUrl: number };
  sourceDiscoveryCoverage: { candidatesByOrigin: Record<string, number>; candidatesByState: Record<string, number>; inventory: unknown; commonCrawl: unknown };
  applicationLinks: { activeJobs: number; missing: number; verifiedOk: number; gone: number; restricted: number; unreachable: number; neverChecked: number };
  supplemental: unknown;
}

export async function buildIngestionReport(): Promise<IngestionReport> {
  const [cand] = await query<any>("SELECT count(*)::text c, count(*) FILTER (WHERE state='active_source')::text active FROM discovery_candidates");
  const latest = await query<{ provider: string; status: string; c: string }>(
    `SELECT provider, status, count(*)::text c FROM (SELECT DISTINCT ON (candidate_id) candidate_id, provider, status FROM source_validations WHERE candidate_id IS NOT NULL ORDER BY candidate_id, checked_at DESC, id DESC) l GROUP BY provider, status`);
  const byProv: Record<string, Record<string, number>> = {};
  const statusTotals: Record<string, number> = {};
  for (const r of latest) { (byProv[r.provider] ??= {})[r.status] = n(r.c); statusTotals[r.status] = (statusTotals[r.status] ?? 0) + n(r.c); }
  const validatedTotal = (statusTotals.valid_with_jobs ?? 0) + (statusTotals.valid_no_jobs ?? 0);
  const validatedEver = Object.values(statusTotals).reduce((a, b) => a + b, 0);
  const inv = (await query<{ value: any; updated_at: string }>("SELECT value, updated_at FROM discovery_state WHERE key='inventory_last_run'"))[0];
  const cc = (await query<{ value: any }>("SELECT value FROM discovery_state WHERE key='commoncrawl'"))[0]?.value ?? null;
  const manifest = (await query<{ value: any }>("SELECT value FROM discovery_state WHERE key='stapply_manifest'"))[0]?.value ?? null;

  const cityRows = await query<{ c: string; srcs: string; live_companies: string; live_jobs: string; missing: string }>(
    `SELECT c.city c,
       (SELECT count(DISTINCT s.company_slug) FROM job_sources s WHERE s.status IN ('active','failing') AND EXISTS (SELECT 1 FROM company_jobs j WHERE j.source_id=s.id AND c.city = ANY(j.cities)))::text srcs,
       (SELECT count(DISTINCT j.company_slug) FROM company_jobs j WHERE j.is_active AND j.source_id IS NOT NULL AND c.city = ANY(j.cities))::text live_companies,
       (SELECT count(*) FROM company_jobs j WHERE j.is_active AND j.source_id IS NOT NULL AND c.city = ANY(j.cities))::text live_jobs,
       (SELECT count(*) FROM company_jobs j WHERE j.is_active AND j.source_id IS NOT NULL AND c.city = ANY(j.cities) AND j.application_url IS NULL)::text missing
     FROM (VALUES ('bengaluru'),('hyderabad'),('chennai')) c(city)`);
  const city = (k: CityKey): CityReport => { const r = cityRows.find((x) => x.c === k)!; return { companiesWithActiveSources: n(r.srcs), companiesWithLiveJobs: n(r.live_companies), activeJobs: n(r.live_jobs), jobsMissingApplicationUrl: n(r.missing) }; };
  const [rem] = await query<any>(`SELECT count(DISTINCT company_slug)::text companies, count(*)::text jobs, count(*) FILTER (WHERE application_url IS NULL)::text missing FROM company_jobs WHERE is_active AND source_id IS NOT NULL AND city_class='india_remote'`);

  const providers = await query<any>(
    `SELECT s.provider, count(*)::text sources, count(*) FILTER (WHERE s.status='active')::text active,
            COALESCE(sum((SELECT count(*) FROM company_jobs j WHERE j.source_id=s.id AND j.is_active)),0)::text jobs
     FROM job_sources s GROUP BY s.provider ORDER BY count(*) DESC, s.provider`);
  const [fresh] = await query<any>(`SELECT max(last_success_at) last_success, count(*) FILTER (WHERE last_success_at > now() - interval '24 hours')::text c24 FROM job_sources`);
  const [runs] = await query<any>(`SELECT count(*)::text c FROM ingestion_runs WHERE started_at > now() - interval '24 hours'`);
  const failCats = await query<any>(`SELECT COALESCE(last_error_category,'unknown') cat, count(*)::text c FROM job_sources WHERE consecutive_failures > 0 OR status IN ('failing','needs_review') GROUP BY 1`);
  const worst = await query<any>(`SELECT s.id, p.name, s.provider, s.consecutive_failures, s.last_error_category, s.last_error FROM job_sources s JOIN company_profiles p ON p.slug=s.company_slug WHERE s.consecutive_failures > 0 OR s.status IN ('failing','needs_review') ORDER BY s.consecutive_failures DESC, s.id LIMIT 20`);
  const staleWhere = `s.status IN ('active','failing') AND (s.last_success_at IS NULL OR s.last_success_at < now() - GREATEST(interval '6 hours', s.poll_interval_minutes * 2 * interval '1 minute'))`;
  const [stale] = await query<any>(`SELECT count(*)::text c FROM job_sources s WHERE ${staleWhere}`);
  const staleList = await query<any>(`SELECT s.id, p.name, s.provider, s.last_success_at FROM job_sources s JOIN company_profiles p ON p.slug=s.company_slug WHERE ${staleWhere} ORDER BY s.last_success_at NULLS FIRST LIMIT 10`);
  const [dups] = await query<any>(`SELECT COALESCE((SELECT sum(jobs_duplicates) FROM ingestion_runs),0)::text dropped, COALESCE((SELECT sum(c-1) FROM (SELECT count(*) c FROM company_jobs WHERE is_active AND source_id IS NOT NULL AND canonical_application_url IS NOT NULL GROUP BY canonical_application_url HAVING count(*)>1) d),0)::text shared`);
  const origins = await query<any>(`SELECT split_part(origin, ':', 1) || CASE WHEN origin LIKE 'ats-scrapers:%' THEN ':inventory' ELSE '' END o, count(*)::text c FROM discovery_candidates GROUP BY 1 ORDER BY 2 DESC`);
  const states = await query<any>(`SELECT state, count(*)::text c FROM discovery_candidates GROUP BY 1`);
  const [links] = await query<any>(`SELECT count(*)::text active, count(*) FILTER (WHERE application_url IS NULL)::text missing,
       count(*) FILTER (WHERE apply_url_status='ok')::text ok, count(*) FILTER (WHERE apply_url_status='gone')::text gone, count(*) FILTER (WHERE apply_url_status='restricted')::text restricted,
       count(*) FILTER (WHERE apply_url_status IN ('unreachable','unsafe'))::text unreachable, count(*) FILTER (WHERE application_url IS NOT NULL AND apply_url_checked_at IS NULL)::text unchecked
     FROM company_jobs WHERE is_active AND source_id IS NOT NULL`);

  const uns = inv?.value?.unsupportedByProvider ?? {};
  return {
    generatedAt: new Date().toISOString(),
    discovery: {
      candidatesDiscovered: n(cand.c), boardsValidated: validatedTotal, boardsRejected: (statusTotals.not_found ?? 0) + (statusTotals.invalid_response ?? 0),
      boardsTemporarilyUnavailable: statusTotals.temporarily_unavailable ?? 0, boardsAccessRestricted: statusTotals.access_restricted ?? 0, unsupportedProviderBoards: statusTotals.unsupported_provider ?? 0,
      notYetValidated: Math.max(0, n(cand.c) - validatedEver), latestStatusByProvider: byProv, activeSources: n(cand.active),
      unsupportedInventoryRows: { total: Object.values(uns as Record<string, number>).reduce((a, b) => a + b, 0), platforms: uns, asOf: inv?.value?.at ?? null },
    },
    cities: { bengaluru: city("bengaluru"), hyderabad: city("hyderabad"), chennai: city("chennai"), indiaRemote: { companiesWithLiveJobs: n(rem.companies), activeJobs: n(rem.jobs), jobsMissingApplicationUrl: n(rem.missing) } },
    providerDistribution: providers.map((p) => ({ provider: p.provider, sources: n(p.sources), activeSources: n(p.active), activeJobs: n(p.jobs) })),
    refresh: { lastSuccessfulRefresh: fresh.last_success ? new Date(fresh.last_success).toISOString() : null, sourcesCheckedLast24h: n(fresh.c24), runsLast24h: n(runs.c) },
    sourceFailures: { total: failCats.reduce((a: number, r: any) => a + n(r.c), 0), byCategory: Object.fromEntries(failCats.map((r: any) => [r.cat, n(r.c)])), worst: worst.map((w) => ({ sourceId: w.id, company: w.name, provider: w.provider, failures: w.consecutive_failures, category: w.last_error_category, error: w.last_error })) },
    staleSources: { count: n(stale.c), oldest: staleList.map((s) => ({ sourceId: s.id, company: s.name, provider: s.provider, lastSuccessAt: s.last_success_at ? new Date(s.last_success_at).toISOString() : null })) },
    duplicates: { duplicateRecordsDroppedFromPayloads: n(dups.dropped), activeJobsSharingAnApplicationUrl: n(dups.shared) },
    sourceDiscoveryCoverage: { candidatesByOrigin: Object.fromEntries(origins.map((o: any) => [o.o, n(o.c)])), candidatesByState: Object.fromEntries(states.map((s: any) => [s.state, n(s.c)])), inventory: inv?.value ? { at: inv.value.at, filesListed: inv.value.filesListed, rowsRead: inv.value.rowsRead, candidatesParsed: inv.value.candidatesParsed, invalidRows: inv.value.invalidRows, duplicatesRemoved: inv.value.duplicatesRemoved, via: inv.value.via } : null, commonCrawl: cc },
    applicationLinks: { activeJobs: n(links.active), missing: n(links.missing), verifiedOk: n(links.ok), gone: n(links.gone), restricted: n(links.restricted), unreachable: n(links.unreachable), neverChecked: n(links.unchecked) },
    supplemental: manifest,
  };
}

/** Plain-text rendering in the layout the brief specifies (used by `npm run jobs:report`). */
export function formatReport(r: IngestionReport): string {
  const d = r.discovery, L: string[] = [];
  L.push("Company candidates discovered      " + d.candidatesDiscovered, "Company boards validated            " + d.boardsValidated, "Company boards rejected             " + d.boardsRejected, "Boards temporarily unavailable      " + d.boardsTemporarilyUnavailable + (d.boardsAccessRestricted ? ` (+${d.boardsAccessRestricted} access restricted)` : ""), "Unsupported provider boards         " + d.unsupportedProviderBoards + ` (+${d.unsupportedInventoryRows.total} inventory rows on ${Object.keys(d.unsupportedInventoryRows.platforms).length} platforms not imported)`, "Candidates not yet validated        " + d.notYetValidated, "");
  for (const [k, label] of [["bengaluru", "Bengaluru"], ["hyderabad", "Hyderabad"], ["chennai", "Chennai"]] as const) {
    const c = r.cities[k];
    L.push(`${label}:`, `  Companies with active sources   ${c.companiesWithActiveSources}`, `  Companies with live jobs        ${c.companiesWithLiveJobs}`, `  Active jobs                     ${c.activeJobs}`, `  Jobs missing application URLs   ${c.jobsMissingApplicationUrl}`, "");
  }
  L.push("India Remote:", `  Companies with live jobs        ${r.cities.indiaRemote.companiesWithLiveJobs}`, `  Active jobs                     ${r.cities.indiaRemote.activeJobs}`, "");
  L.push("Provider distribution: " + (r.providerDistribution.map((p) => `${p.provider} ${p.activeSources}/${p.sources} sources, ${p.activeJobs} jobs`).join("; ") || "none"));
  L.push("Last successful refresh: " + (r.refresh.lastSuccessfulRefresh ?? "never"), `Source failures: ${r.sourceFailures.total} ${JSON.stringify(r.sourceFailures.byCategory)}`, `Stale sources: ${r.staleSources.count}`);
  L.push(`Duplicates: ${r.duplicates.duplicateRecordsDroppedFromPayloads} payload duplicates dropped; ${r.duplicates.activeJobsSharingAnApplicationUrl} active jobs share an application URL with another`);
  const a = r.applicationLinks;
  L.push(`Application links (active jobs ${a.activeJobs}): missing ${a.missing}, verified ok ${a.verifiedOk}, gone ${a.gone}, restricted ${a.restricted}, unreachable ${a.unreachable}, never checked ${a.neverChecked}`);
  return L.join("\n");
}
