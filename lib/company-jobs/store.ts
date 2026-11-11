import { query, withTransaction } from "@/lib/database";
import type { CompanyJobRecord } from "./adapter";
import { canonicalApplicationUrl } from "./urls";

export interface CompanyProfileRow {
  slug: string;
  name: string;
  website: string | null;
  careers_url: string | null;
  logo_url: string | null;
  logo_source_domain: string | null;
  logo_status: string | null;
  last_jobs_fetch_at: string | null;
  last_jobs_success_at: string | null;
  last_jobs_error: string | null;
  last_jobs_error_category: string | null;
  last_http_status: number | null;
  jobs_stale: boolean;
}

export async function upsertCompanyProfile(slug: string, name: string, extra: Partial<{ website: string | null; careers_url: string | null }> = {}) {
  await query(
    `INSERT INTO company_profiles (slug, name, website, careers_url)
     VALUES ($1::text,$2::text,$3::text,$4::text)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       website = COALESCE(EXCLUDED.website, company_profiles.website),
       careers_url = COALESCE(EXCLUDED.careers_url, company_profiles.careers_url)`,
    [slug, name, extra.website ?? null, extra.careers_url ?? null]
  );
}

export async function recordCompanyFetch(
  slug: string,
  r: { ok: boolean; stale?: boolean; error?: string | null; category?: string | null; httpStatus?: number | null }
) {
  await query(
    `UPDATE company_profiles SET
       last_jobs_fetch_at = now(),
       last_jobs_success_at = CASE WHEN $2 THEN now() ELSE last_jobs_success_at END,
       last_jobs_error = $3,
       last_jobs_error_category = $4,
       last_http_status = $5,
       jobs_stale = CASE WHEN $2 THEN false ELSE COALESCE($6, jobs_stale) END
     WHERE slug = $1`,
    [slug, r.ok, r.ok ? null : r.error ?? null, r.ok ? null : r.category ?? null, r.httpStatus ?? null, r.stale === true]
  );
}

export async function persistCompanyJobs(slug: string, incoming: CompanyJobRecord[], opts: { complete: boolean; source: string }): Promise<{ inserted: number; updated: number; recovered: number }> {
  let inserted = 0;
  let updated = 0;
  let recovered = 0;
  await withTransaction(async (q) => {
    await q("SELECT pg_advisory_xact_lock(hashtext($1::text))", [`company-jobs:${slug}`]);
    const existing = await q<{
      id: number;
      source: string;
      external_job_id: string | null;
      application_url: string | null;
      title: string;
      location: string | null;
    }>("SELECT id, source, external_job_id, application_url, title, location FROM company_jobs WHERE company_slug = $1", [slug]);
    const seen: number[] = [];
    for (const j of incoming) {
      const canon = canonicalApplicationUrl(j.applicationUrl);
      let row = j.externalJobId
        ? existing.find((e) => e.source === j.source && e.external_job_id === j.externalJobId)
        : undefined;
      if (!row && canon) row = existing.find((e) => e.source === j.source && canonicalApplicationUrl(e.application_url) === canon);
      const params = [
        slug, j.externalJobId, j.title, j.normalizedTitle, j.seniority, j.workMode, j.employmentType, j.location,
        j.applicationUrl, canon, j.jobDetailUrl, j.postedAt, j.fresherFriendly, j.experienceMin, j.experienceMax,
        j.salaryMin, j.salaryMax, j.salaryEstimated, j.description, j.roleFamily, j.source,
      ];
      if (row) {
        await q(
          `UPDATE company_jobs SET
             external_job_id=COALESCE(external_job_id, $2::text), title=$3::text, normalized_title=$4::text, seniority=$5::text, work_mode=$6::text, employment_type=$7::text, location=$8::text,
             application_url=COALESCE($9::text, application_url),
             canonical_application_url=COALESCE($10::text, canonical_application_url),
             job_detail_url=COALESCE($11::text, job_detail_url),
             posted_at=COALESCE($12::timestamptz, posted_at),
             fresher_friendly=$13::boolean, experience_min=$14::numeric, experience_max=$15::numeric,
             salary_min=$16::numeric, salary_max=$17::numeric, salary_estimated=$18::boolean,
             description=COALESCE($19::text, description), role_family=$20::text,
             last_seen_at=now(), last_verified_at=now(), is_stale=false, is_active=true
           WHERE id=$22::int AND company_slug=$1::text AND $21::text IS NOT NULL`,
          [...params, row.id]
        );
        updated++;
        if (!row.application_url && j.applicationUrl) recovered++; // a link we did not have before
        seen.push(row.id);
      } else {
        const rows = await q<{ id: number }>(
          `INSERT INTO company_jobs (
             company_slug, external_job_id, title, normalized_title, seniority, work_mode, employment_type, location,
             application_url, canonical_application_url, job_detail_url, posted_at, fresher_friendly, experience_min, experience_max,
             salary_min, salary_max, salary_estimated, description, role_family, source, last_verified_at
           ) VALUES ($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text,$12::timestamptz,$13::boolean,$14::numeric,$15::numeric,$16::numeric,$17::numeric,$18::boolean,$19::text,$20::text,$21::text, now())
           RETURNING id`,
          params
        );
        inserted++;
        seen.push(rows[0].id);
      }
    }
    if (opts.complete) {
      await q(
        `UPDATE company_jobs SET is_active=false WHERE company_slug=$1 AND source=$2 AND NOT (id = ANY($3::int[]))`,
        [slug, opts.source, seen]
      );
    }
  });
  return { inserted, updated, recovered };
}

export async function markCompanyJobsStale(slug: string, source?: string) {
  await query(
    `UPDATE company_jobs SET is_stale=true WHERE company_slug=$1 AND is_active=true AND ($2::text IS NULL OR source=$2)`,
    [slug, source ?? null]
  );
}

export async function listJobsForSlug(slug: string): Promise<CompanyJobRecord[]> {
  const rows = await query<CompanyJobRecord & { posted_at: string | null; fresher_friendly: boolean | null; experience_min: string | null; experience_max: string | null; salary_min: string | null; salary_max: string | null; salary_estimated: boolean | null; role_family: string | null; external_job_id: string | null; application_url: string | null; job_detail_url: string | null; work_mode: CompanyJobRecord["workMode"]; employment_type: string | null; normalized_title: string | null; company_slug: string }>(
    `SELECT company_slug, external_job_id, title, normalized_title, seniority, work_mode, employment_type, location,
            application_url, job_detail_url, posted_at::text, fresher_friendly, experience_min, experience_max,
            salary_min, salary_max, salary_estimated, description, role_family, source
     FROM company_jobs WHERE company_slug=$1 AND is_active
     ORDER BY posted_at DESC NULLS LAST, title`,
    [slug]
  );
  return rows.map((r) => ({
    companySlug: r.company_slug,
    externalJobId: r.external_job_id,
    title: r.title,
    normalizedTitle: r.normalized_title,
    seniority: r.seniority,
    workMode: r.work_mode,
    employmentType: r.employment_type,
    location: r.location,
    applicationUrl: r.application_url,
    jobDetailUrl: r.job_detail_url,
    postedAt: r.posted_at,
    fresherFriendly: r.fresher_friendly,
    experienceMin: r.experience_min == null ? null : Number(r.experience_min),
    experienceMax: r.experience_max == null ? null : Number(r.experience_max),
    salaryMin: r.salary_min == null ? null : Number(r.salary_min),
    salaryMax: r.salary_max == null ? null : Number(r.salary_max),
    salaryEstimated: r.salary_estimated,
    description: r.description,
    roleFamily: r.role_family,
    source: r.source,
  }));
}

export async function trustedWebsiteFor(slug: string, name: string): Promise<string | null> {
  const [own] = await query<{ website: string | null }>("SELECT website FROM company_profiles WHERE slug=$1", [slug]);
  if (own?.website) return own.website;
  const { normalizeCompanyName } = await import("@/lib/normalize");
  const norm = normalizeCompanyName(name);
  if (!norm) return null;
  const [s] = await query<{ website: string | null }>(
    `SELECT website FROM startups WHERE website IS NOT NULL AND normalized_name = $1 LIMIT 1`,
    [norm]
  );
  return s?.website ?? null;
}

export async function saveSyncRun(stats: object) {
  await query(`INSERT INTO company_job_sync_runs (stats) VALUES ($1)`, [JSON.stringify(stats)]);
}

export async function latestSyncRun(): Promise<{ started_at: string; finished_at: string | null; stats: Record<string, unknown> } | null> {
  const [r] = await query("SELECT started_at, finished_at, stats FROM company_job_sync_runs ORDER BY id DESC LIMIT 1");
  return r ?? null;
}
