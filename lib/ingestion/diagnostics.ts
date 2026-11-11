import { query } from "@/lib/database";
import { candidateCounts } from "./discovery/candidates";

const n = (v: unknown) => Number(v ?? 0);

export async function ingestionDiagnostics() {
  const [jobs] = await query<any>(
    `SELECT count(*) FILTER (WHERE is_active)::text active,
            count(*) FILTER (WHERE is_active AND application_url IS NULL)::text missing_apply,
            count(*) FILTER (WHERE is_active AND city_class IN ('bengaluru','both'))::text blr,
            count(*) FILTER (WHERE is_active AND city_class IN ('hyderabad','both'))::text hyd,
            count(*) FILTER (WHERE is_active AND city_class = 'india_remote')::text remote,
            count(DISTINCT company_slug) FILTER (WHERE is_active AND city_class IN ('bengaluru','both'))::text blr_companies,
            count(DISTINCT company_slug) FILTER (WHERE is_active AND city_class IN ('hyderabad','both'))::text hyd_companies,
            count(DISTINCT company_slug) FILTER (WHERE is_active AND city_class = 'india_remote')::text remote_companies,
            count(*) FILTER (WHERE first_seen_at > now() - interval '24 hours')::text new_24h,
            count(*) FILTER (WHERE closed_at > now() - interval '24 hours')::text closed_24h
     FROM company_jobs WHERE source_id IS NOT NULL`);
  const [src] = await query<any>(
    `SELECT count(*)::text total,
            count(*) FILTER (WHERE status='active')::text active,
            count(*) FILTER (WHERE status IN ('failing','needs_review'))::text failing,
            count(*) FILTER (WHERE status='paused')::text paused,
            count(*) FILTER (WHERE consecutive_rate_limits >= 2)::text rate_limited,
            count(*) FILTER (WHERE last_success_at > now() - interval '24 hours')::text checked_24h,
            max(last_success_at) last_success,
            min(last_success_at) FILTER (WHERE status IN ('active','failing')) oldest_success
     FROM job_sources`);
  const [runs] = await query<any>(`SELECT COALESCE(sum(jobs_updated),0)::text updated_24h, count(*)::text runs_24h FROM ingestion_runs WHERE started_at > now() - interval '24 hours'`);
  const [noBoard] = await query<any>(`SELECT count(*)::text c FROM company_profiles p WHERE NOT EXISTS (SELECT 1 FROM job_sources s WHERE s.company_slug = p.slug)`);
  const states = await candidateCounts();
  const [oldest] = await query<any>(`SELECT s.id, p.name, s.provider, s.last_success_at FROM job_sources s JOIN company_profiles p ON p.slug=s.company_slug WHERE s.status IN ('active','failing') ORDER BY s.last_success_at NULLS FIRST LIMIT 1`);
  const providers = await query<any>(`SELECT provider, count(*)::text sources, count(*) FILTER (WHERE status='active')::text active FROM job_sources GROUP BY provider ORDER BY provider`);
  return {
    companies: { discoveredCandidates: Object.values(states).reduce((a, b) => a + b, 0), candidatesByState: states, validatedBoards: n(states.board_validated) + n(states.active_source), withoutValidatedBoard: n(noBoard?.c) },
    sources: { total: n(src.total), active: n(src.active), failing: n(src.failing), paused: n(src.paused), repeatedRateLimits: n(src.rate_limited), checkedLast24h: n(src.checked_24h), lastSuccessfulSync: src.last_success, oldestStale: oldest ? { sourceId: oldest.id, company: oldest.name, provider: oldest.provider, lastSuccessAt: oldest.last_success_at } : null, byProvider: providers.map((p) => ({ provider: p.provider, sources: n(p.sources), active: n(p.active) })) },
    jobs: { active: n(jobs.active), newLast24h: n(jobs.new_24h), updatedLast24h: n(runs.updated_24h), closedLast24h: n(jobs.closed_24h), missingApplyLink: n(jobs.missing_apply) },
    coverage: { bengaluru: { jobs: n(jobs.blr), companies: n(jobs.blr_companies) }, hyderabad: { jobs: n(jobs.hyd), companies: n(jobs.hyd_companies) }, indiaRemote: { jobs: n(jobs.remote), companies: n(jobs.remote_companies) } },
    runsLast24h: n(runs.runs_24h),
  };
}

export async function listSources(limit = 200) {
  return query<any>(
    `SELECT s.id, s.company_slug, p.name company, s.provider, s.board_slug, s.tenant, s.host, s.career_site, s.status, s.priority, s.poll_interval_minutes, s.last_checked_at, s.last_success_at, s.next_check_at,
            s.consecutive_failures, s.last_error, s.last_error_category, s.last_http_status,
            (SELECT count(*) FROM company_jobs j WHERE j.source_id=s.id AND j.is_active)::int active_jobs
     FROM job_sources s JOIN company_profiles p ON p.slug=s.company_slug ORDER BY (s.status<>'active') DESC, s.last_success_at NULLS FIRST LIMIT $1`, [limit]);
}

export async function sourceDetail(id: number) {
  const [source] = await query<any>(`SELECT id, company_slug, provider, board_slug, tenant, host, career_site, source_url, status, priority, poll_interval_minutes, last_checked_at, last_success_at, next_check_at, consecutive_failures, consecutive_rate_limits, last_error, last_error_category, last_http_status, validation, last_sample FROM job_sources WHERE id=$1`, [id]);
  if (!source) return null;
  const history = await query<any>(`SELECT id, started_at, completed_at, status, http_status, jobs_fetched, jobs_inserted, jobs_updated, jobs_closed, jobs_unchanged, jobs_reopened, jobs_missing_apply_url, error_category, error_message, duration_ms FROM ingestion_runs WHERE source_id=$1 ORDER BY started_at DESC LIMIT 50`, [id]);
  return { source, history };
}
