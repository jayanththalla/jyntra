// Read side: the UI only ever queries this (database-backed). No ATS call happens here.
import { query } from "@/lib/database";

export interface FeedParams { city?: string; q?: string; role?: string; years?: number; type?: string; company?: string; postedWithinDays?: number; fresh?: boolean; remoteOnly?: boolean; page?: number; pageSize?: number }
export type FreshnessState = "fresh" | "delayed" | "unavailable";
export interface FeedJob {
  id: number; title: string; cities: string[]; company: { slug: string; name: string; logoSrc: string }; locations: string[]; cityClass: string; remoteIndia: boolean; workplaceType: string | null;
  employmentType: string | null; experienceMin: number | null; experienceMax: number | null; roleFamily: string | null;
  postedAt: string | null; firstSeenAt: string; lastCheckedAt: string | null; applyUrl: string | null; provider: string | null;
  freshness: { state: FreshnessState; label: string }; licenseClass: string | null; attribution: string | null;
}

const CITY: Record<string, string> = {
  target: "(j.cities && ARRAY['bengaluru','hyderabad','chennai']::text[] OR j.city_class = 'india_remote')",
  bengaluru: "'bengaluru' = ANY(j.cities)",
  hyderabad: "'hyderabad' = ANY(j.cities)",
  chennai: "'chennai' = ANY(j.cities)",
  remote: "j.city_class = 'india_remote'",
  other_india: "j.city_class = 'other_india'",
  all: "TRUE",
};

export function freshness(s: { status: string | null; lastSuccessAt: string | null; intervalMinutes: number | null }, now = Date.now()): { state: FreshnessState; label: string } {
  if (!s.status || s.status === "needs_review" || s.status === "paused") return { state: "unavailable", label: "Source unavailable" };
  if (s.status === "failing") return { state: "unavailable", label: "Source temporarily unavailable" };
  const last = s.lastSuccessAt ? Date.parse(s.lastSuccessAt) : NaN;
  const limit = Math.max(6 * 3600_000, 2 * (s.intervalMinutes ?? 180) * 60_000);
  if (!Number.isFinite(last) || now - last > limit) return { state: "delayed", label: "Source stale" };
  return { state: "fresh", label: "Checked recently" };
}

export async function queryFeed(p: FeedParams): Promise<{ total: number; page: number; pageSize: number; jobs: FeedJob[] }> {
  const where: string[] = ["j.is_active", "j.source_id IS NOT NULL", CITY[p.city ?? "target"] ?? CITY.target!];
  const args: unknown[] = [];
  const arg = (v: unknown) => (args.push(v), `$${args.length}`);
  if (p.q?.trim()) { const a = arg(`%${p.q.trim().replace(/[%_\\]/g, "\\$&")}%`); where.push(`(j.title ILIKE ${a} OR c.name ILIKE ${a} OR array_to_string(j.locations,' ') ILIKE ${a})`); }
  if (p.role) where.push(`j.role_family = ${arg(p.role)}`);
  if (p.years !== undefined && Number.isFinite(p.years)) { const a = arg(p.years); where.push(`(j.experience_min IS NULL OR j.experience_min <= ${a})`, `(j.experience_max IS NULL OR j.experience_max >= ${a})`); }
  if (p.type) where.push(`j.employment_type ILIKE ${arg(`%${p.type.replace(/[%_\\]/g, "\\$&")}%`)}`);
  if (p.company) where.push(`j.company_slug = ${arg(p.company)}`);
  if (p.postedWithinDays) where.push(`j.posted_at >= now() - make_interval(days => ${arg(Math.min(365, Math.floor(p.postedWithinDays)))})`);
  if (p.remoteOnly) where.push("j.remote_india");
  if (p.fresh) where.push(`s.status = 'active' AND s.last_success_at > now() - GREATEST(interval '6 hours', s.poll_interval_minutes * 2 * interval '1 minute')`);
  const pageSize = Math.min(50, Math.max(1, Math.floor(p.pageSize ?? 20)));
  const page = Math.max(1, Math.floor(p.page ?? 1));
  const rows = await query<any>(
    `SELECT j.id, j.title, j.company_slug, c.name company_name, j.locations, j.location, j.city_class, j.remote_india, j.workplace_type, j.employment_type,
            j.experience_min, j.experience_max, j.role_family, j.cities, j.posted_at, j.first_seen_at, j.last_verified_at, j.application_url, j.provider, j.license_class, j.attribution,
            s.status src_status, s.last_success_at, s.poll_interval_minutes, count(*) OVER() total
     FROM company_jobs j JOIN company_profiles c ON c.slug = j.company_slug LEFT JOIN job_sources s ON s.id = j.source_id
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC, j.id DESC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    args,
  );
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    total: rows[0] ? Number(rows[0].total) : 0, page, pageSize,
    jobs: rows.map((r): FeedJob => ({
      id: r.id, title: r.title, cities: r.cities ?? [], company: { slug: r.company_slug, name: r.company_name, logoSrc: `/api/companies/${r.company_slug}/logo` },
      locations: r.locations?.length ? r.locations : r.location ? [r.location] : [], cityClass: r.city_class ?? "unknown", remoteIndia: r.remote_india, workplaceType: r.workplace_type,
      employmentType: r.employment_type, experienceMin: num(r.experience_min), experienceMax: num(r.experience_max), roleFamily: r.role_family,
      postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null, firstSeenAt: new Date(r.first_seen_at).toISOString(), lastCheckedAt: r.last_success_at ? new Date(r.last_success_at).toISOString() : null,
      applyUrl: r.application_url, provider: r.provider,
      freshness: freshness({ status: r.src_status, lastSuccessAt: r.last_success_at ? new Date(r.last_success_at).toISOString() : null, intervalMinutes: r.poll_interval_minutes }),
      licenseClass: r.license_class, attribution: r.attribution,
    })),
  };
}
