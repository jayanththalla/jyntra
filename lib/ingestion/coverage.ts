// Public, DB-only coverage summary so a zero-result city can say what is actually being watched (never invents jobs).
import { query } from "@/lib/database";
export async function coverageSummary() {
  const [s] = await query<any>(`SELECT count(*) FILTER (WHERE status IN ('active','failing'))::text boards, count(DISTINCT company_slug) FILTER (WHERE status IN ('active','failing'))::text companies, max(last_success_at) last_success FROM job_sources`);
  const rows = await query<any>(`SELECT c.city, (SELECT count(*) FROM company_jobs j WHERE j.is_active AND j.source_id IS NOT NULL AND c.city = ANY(j.cities))::text jobs FROM (VALUES ('bengaluru'),('hyderabad'),('chennai')) c(city)`);
  const [r] = await query<any>(`SELECT count(*)::text jobs FROM company_jobs WHERE is_active AND source_id IS NOT NULL AND city_class='india_remote'`);
  return { boardsWatched: Number(s.boards), companiesWatched: Number(s.companies), lastSuccessfulRefresh: s.last_success ? new Date(s.last_success).toISOString() : null, jobsByCity: { ...Object.fromEntries(rows.map((x: any) => [x.city, Number(x.jobs)])), india_remote: Number(r.jobs) } as Record<string, number> };
}
