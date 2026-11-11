// Idempotent job upsert for ONE source, in one transaction, with the safety rules from the spec:
//  - identity = (source_id, external_job_id); re-running the same payload changes nothing
//  - a null/invalid apply URL never overwrites a stored valid one
//  - a job is closed ONLY when the fetch was complete (caller passes `complete`), never on failure
//  - reopened jobs keep first_seen_at and are restored
import { withTransaction } from "@/lib/database";
import { canonicalApplicationUrl } from "@/lib/company-jobs/urls";
import { roleFamily } from "./role";
import type { NormalizedJob } from "./types";

export interface PersistStats { duplicatesDropped: number; inserted: number; updated: number; unchanged: number; closed: number; reopened: number; missingApplyUrl: number; closureSkipped: string | null }

/** An empty "complete" answer from a board that had many open jobs is far more likely a parsing/outage problem than every job closing at once. */
const SUSPICIOUS_EMPTY_THRESHOLD = 5;

const workMode = (w: string) => (w === "remote" || w === "hybrid" || w === "onsite" ? w : "unknown");

export async function persistJobs(
  src: { id: number; companySlug: string; provider: string; licenseClass?: string; attribution?: string | null },
  incoming: NormalizedJob[],
  opts: { complete: boolean },
): Promise<PersistStats> {
  const stats: PersistStats = { duplicatesDropped: 0, inserted: 0, updated: 0, unchanged: 0, closed: 0, reopened: 0, missingApplyUrl: 0, closureSkipped: null };
  // De-duplicate inside the payload (last one wins): the unique index would otherwise abort the whole transaction.
  const byId = new Map<string, NormalizedJob>();
  for (const j of incoming) byId.set(j.externalJobId, j);
  const jobs = [...byId.values()];
  stats.duplicatesDropped = incoming.length - jobs.length;
  const sourceTag = `ats:${src.provider}:${src.id}`;

  await withTransaction(async (q) => {
    await q("SELECT pg_advisory_xact_lock(hashtext($1::text))", [`ingest-source:${src.id}`]);
    const existing = await q<{ id: number; external_job_id: string; content_hash: string | null; status: string; application_url: string | null }>(
      "SELECT id, external_job_id, content_hash, status, application_url FROM company_jobs WHERE source_id = $1",
      [src.id],
    );
    const known = new Map(existing.map((e) => [e.external_job_id, e]));
    const unchangedIds: number[] = [];

    for (const j of jobs) {
      if (!j.applyUrl) stats.missingApplyUrl++;
      const prev = known.get(j.externalJobId);
      const canon = canonicalApplicationUrl(j.applyUrl);
      const params = [
        j.companySlug, sourceTag, j.externalJobId, j.title, j.locationText, workMode(j.workplaceType), j.employmentType, j.applyUrl, canon, j.sourceUrl,
        j.postedAt, j.experienceMin, j.experienceMax, j.salaryMin, j.salaryMax, j.description, roleFamily(j.title), src.id, src.provider, j.contentHash,
        j.locations, j.cityClass, j.remoteIndia, j.workplaceType, j.salaryCurrency, j.salaryPeriod, j.metadata?.postedAtApprox === true, src.licenseClass ?? "employer_public", src.attribution ?? null, j.cities,
      ];
      if (!prev) {
        await q(
          `INSERT INTO company_jobs (company_slug, source, external_job_id, title, location, work_mode, employment_type, application_url, canonical_application_url, job_detail_url,
             posted_at, experience_min, experience_max, salary_min, salary_max, description, role_family, source_id, provider, content_hash,
             locations, city_class, remote_india, workplace_type, salary_currency, salary_period, posted_at_approx, license_class, attribution, cities,
             first_seen_at, last_seen_at, last_verified_at, is_active, is_stale, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::text[], now(), now(), now(), true, false, 'active')`,
          params,
        );
        stats.inserted++;
        continue;
      }
      if (prev.status === "active" && prev.content_hash === j.contentHash) {
        unchangedIds.push(prev.id);
        stats.unchanged++;
        continue;
      }
      const wasClosed = prev.status === "closed";
      await q(
        `UPDATE company_jobs SET
           title=$4, location=$5, work_mode=$6, employment_type=$7,
           application_url = COALESCE($8, application_url),
           canonical_application_url = COALESCE($9, canonical_application_url),
           job_detail_url = COALESCE($10, job_detail_url),
           posted_at = CASE WHEN $27 AND posted_at IS NOT NULL THEN posted_at ELSE COALESCE($11::timestamptz, posted_at) END,
           posted_at_approx = CASE WHEN posted_at IS NOT NULL AND $27 THEN posted_at_approx ELSE $27 END,
           experience_min=$12, experience_max=$13, salary_min=$14, salary_max=$15,
           description = COALESCE($16, description), role_family=$17, provider=$19, content_hash=$20,
           locations=$21, city_class=$22, remote_india=$23, workplace_type=$24, salary_currency=$25, salary_period=$26,
           license_class=$28, attribution=$29, cities=$30::text[], source=$2,
           last_seen_at=now(), last_verified_at=now(), is_stale=false, is_active=true, status='active', closed_at=NULL,
           reopened_count = reopened_count + CASE WHEN $31 THEN 1 ELSE 0 END, updated_at=now()
         WHERE id=$32 AND source_id=$18 AND company_slug=$1 AND external_job_id=$3::text`,
        [...params, wasClosed, prev.id],
      );
      stats.updated++;
      if (wasClosed) stats.reopened++;
    }
    if (unchangedIds.length) {
      await q("UPDATE company_jobs SET last_seen_at=now(), last_verified_at=now(), is_stale=false WHERE id = ANY($1::bigint[])", [unchangedIds]);
    }

    if (opts.complete) {
      const activeBefore = existing.filter((e) => e.status === "active").length;
      if (jobs.length === 0 && activeBefore >= SUSPICIOUS_EMPTY_THRESHOLD) {
        stats.closureSkipped = `empty complete response for a board with ${activeBefore} open jobs; closures withheld`;
      } else {
        const seen = jobs.map((j) => j.externalJobId);
        const closed = await q<{ id: number }>(
          `UPDATE company_jobs SET status='closed', is_active=false, closed_at=now(), updated_at=now()
           WHERE source_id=$1 AND status='active' AND NOT (external_job_id = ANY($2::text[])) RETURNING id`,
          [src.id, seen],
        );
        stats.closed = closed.length;
      }
    }
  });
  return stats;
}

/** A failed/partial fetch keeps every job; it only flags them so the UI can say "not re-checked". */
export async function markSourceJobsStale(sourceId: number) {
  const { query } = await import("@/lib/database");
  await query("UPDATE company_jobs SET is_stale = true WHERE source_id = $1 AND status = 'active'", [sourceId]);
}
