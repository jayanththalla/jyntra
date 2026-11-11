// Database access for job_sources / companies / runs. All SQL for sources lives here.
import { query } from "@/lib/database";
import { slugify } from "@/lib/company-jobs/boards";
import { normalizeCompanyName } from "@/lib/normalize";
import type { JobSource, ProviderId } from "./types";

export interface SourceRow {
  id: number;
  company_slug: string;
  provider: ProviderId;
  board_slug: string | null;
  tenant: string | null;
  host: string | null;
  career_site: string | null;
  source_url: string | null;
  config: Record<string, unknown>;
  status: "active" | "paused" | "failing" | "needs_review";
  priority: "high" | "normal";
  poll_interval_minutes: number;
  last_checked_at: string | null;
  last_success_at: string | null;
  next_check_at: string;
  consecutive_failures: number;
  consecutive_rate_limits: number;
  last_error: string | null;
  last_error_category: string | null;
  last_http_status: number | null;
  etag: string | null;
  last_modified: string | null;
  locked_until: string | null;
  license_class: string;
  attribution: string | null;
  validation: unknown;
}

export const toJobSource = (r: SourceRow): JobSource => ({
  id: r.id, companySlug: r.company_slug, provider: r.provider, boardSlug: r.board_slug, tenant: r.tenant, host: r.host,
  careerSite: r.career_site, sourceUrl: r.source_url, etag: r.etag, lastModified: r.last_modified, config: r.config ?? {},
});

export const defaultIntervalMinutes = () => {
  const n = Number(process.env.JOB_SYNC_DEFAULT_INTERVAL_MINUTES);
  return Number.isFinite(n) && n >= 5 ? Math.floor(n) : 60;
};

/** Slug for a new company: slugified name, de-duplicated against a different company already using it. */
export async function ensureCompany(name: string, extra: { website?: string | null; careersUrl?: string | null; officialDomain?: string | null; industry?: string | null; companyType?: string | null } = {}): Promise<string> {
  const base = slugify(name) || "company";
  const norm = normalizeCompanyName(name);
  // Same normalised name → same company (idempotent imports).
  const same = await query<{ slug: string }>("SELECT slug FROM company_profiles WHERE slug = $1 OR lower(name) = lower($2) LIMIT 1", [base, name]);
  const slug = same[0]?.slug ?? base;
  await query(
    `INSERT INTO company_profiles (slug, name, website, careers_url, official_domain, industry, company_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (slug) DO UPDATE SET
       website = COALESCE(company_profiles.website, EXCLUDED.website),
       careers_url = COALESCE(company_profiles.careers_url, EXCLUDED.careers_url),
       official_domain = COALESCE(company_profiles.official_domain, EXCLUDED.official_domain),
       industry = COALESCE(company_profiles.industry, EXCLUDED.industry),
       company_type = COALESCE(company_profiles.company_type, EXCLUDED.company_type),
       updated_at = now()`,
    [slug, name, extra.website ?? null, extra.careersUrl ?? null, extra.officialDomain ?? null, extra.industry ?? null, extra.companyType ?? null],
  );
  void norm;
  return slug;
}

export async function upsertSource(s: Omit<JobSource, "id" | "etag" | "lastModified"> & { priority?: "high" | "normal"; pollIntervalMinutes?: number; validation?: unknown; status?: SourceRow["status"] }): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO job_sources (company_slug, provider, board_slug, tenant, host, career_site, source_url, config, priority, poll_interval_minutes, validation, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12)
     ON CONFLICT (provider, COALESCE(board_slug,''), COALESCE(tenant,''), COALESCE(host,''), COALESCE(career_site,'')) DO UPDATE SET
       source_url = COALESCE(EXCLUDED.source_url, job_sources.source_url),
       validation = COALESCE(EXCLUDED.validation, job_sources.validation),
       updated_at = now()
     RETURNING id`,
    [s.companySlug, s.provider, s.boardSlug, s.tenant, s.host, s.careerSite, s.sourceUrl, JSON.stringify(s.config ?? {}), s.priority ?? "normal", s.pollIntervalMinutes ?? defaultIntervalMinutes(), s.validation ? JSON.stringify(s.validation) : null, s.status ?? "active"],
  );
  return rows[0]!.id;
}

export async function getSource(id: number): Promise<SourceRow | null> {
  return (await query<SourceRow>("SELECT * FROM job_sources WHERE id=$1", [id]))[0] ?? null;
}

/**
 * Lease-based claim. FOR UPDATE SKIP LOCKED + locked_until means two workers (or two passes) never get the same source,
 * and a crashed worker's lease simply expires. High-priority and most-overdue sources first.
 */
export async function claimDueSources(limit: number, leaseSeconds: number, now = new Date()): Promise<SourceRow[]> {
  return query<SourceRow>(
    `UPDATE job_sources SET locked_until = $3::timestamptz + make_interval(secs => $2::int)
     WHERE id IN (
       SELECT id FROM job_sources
       WHERE status IN ('active','failing') AND next_check_at <= $3::timestamptz AND (locked_until IS NULL OR locked_until < $3::timestamptz)
       ORDER BY (priority = 'high') DESC, next_check_at
       LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [limit, leaseSeconds, now.toISOString()],
  );
}

export async function releaseLeases(ids: number[]) {
  if (ids.length) await query("UPDATE job_sources SET locked_until = NULL WHERE id = ANY($1::bigint[])", [ids]);
}

export async function startRun(sourceId: number): Promise<number> {
  return (await query<{ id: number }>("INSERT INTO ingestion_runs (source_id) VALUES ($1) RETURNING id", [sourceId]))[0]!.id;
}

/** Claim sources for an operator-run sync regardless of `next_check_at`, still honouring leases so the worker never runs the same board at the same time. */
export async function claimSourcesNow(o: { limit?: number; provider?: string | null; leaseSeconds?: number; onlyCity?: string | null } = {}): Promise<SourceRow[]> {
  return query<SourceRow>(
    `UPDATE job_sources SET locked_until = now() + make_interval(secs => $2::int)
     WHERE id IN (
       SELECT s.id FROM job_sources s
       WHERE s.status IN ('active','failing') AND (s.locked_until IS NULL OR s.locked_until < now())
         AND ($3::text IS NULL OR s.provider = $3)
         AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM company_jobs j WHERE j.source_id = s.id AND j.is_active AND $4 = ANY(j.cities)) OR s.last_success_at IS NULL)
       ORDER BY (s.priority = 'high') DESC, s.last_success_at NULLS FIRST, s.id
       LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [o.limit ?? 100000, o.leaseSeconds ?? 20 * 60, o.provider ?? null, o.onlyCity ?? null],
  );
}
