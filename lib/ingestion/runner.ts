// Runs ONE source: fetch → normalise (inside the provider) → persist → record health. Never throws for provider failures.
import { query } from "@/lib/database";
import { backoffSeconds } from "./http";
import { markSourceJobsStale, persistJobs, type PersistStats } from "./persist";
import { getProvider } from "./providers";
import { getSource, startRun, toJobSource, type SourceRow } from "./source-store";
import { IngestError, type IngestErrorCategory, type ProviderFetchResult } from "./types";

export interface RunOutcome {
  sourceId: number;
  status: "success" | "not_modified" | "partial" | "failed" | "cancelled";
  category?: IngestErrorCategory;
  error?: string;
  stats?: PersistStats;
  fetched: number;
  httpStatus: number | null;
  durationMs: number;
}

const MAX_FAILURES_BEFORE_REVIEW = 20; // circuit stays half-open (slow retries) until here, then an admin must look
const FAILING_AFTER = 3;
/** Categories that mean "the endpoint says no", where hammering makes things worse. */
const SLOW_CATEGORIES = new Set<IngestErrorCategory>(["blocked", "challenge", "rate_limited"]);

export interface RunOptions { signal?: AbortSignal; now?: () => Date; rnd?: () => number; maxPages?: number }

function nextCheckAfterSuccess(row: SourceRow, rnd: () => number, now: Date): Date {
  const minutes = row.poll_interval_minutes * (0.9 + 0.2 * rnd()); // ±10 % jitter so boards never line up
  return new Date(now.getTime() + minutes * 60_000);
}

export async function runSource(sourceId: number, o: RunOptions = {}): Promise<RunOutcome> {
  const t0 = Date.now();
  const now = o.now ?? (() => new Date());
  const rnd = o.rnd ?? Math.random;
  const row = await getSource(sourceId);
  if (!row) return { sourceId, status: "failed", category: "client_error", error: "source not found", fetched: 0, httpStatus: null, durationMs: 0 };
  const runId = await startRun(sourceId);
  const finish = async (r: { status: RunOutcome["status"]; http?: number | null; fetched?: number; stats?: PersistStats; category?: string; error?: string }) => {
    await query(
      `UPDATE ingestion_runs SET completed_at=now(), status=$2, http_status=$3, jobs_fetched=$4, jobs_inserted=$5, jobs_updated=$6, jobs_closed=$7, jobs_unchanged=$8,
         jobs_reopened=$9, jobs_missing_apply_url=$10, error_category=$11, error_message=$12, duration_ms=$13, jobs_duplicates=$14 WHERE id=$1`,
      [runId, r.status, r.http ?? null, r.fetched ?? 0, r.stats?.inserted ?? 0, r.stats?.updated ?? 0, r.stats?.closed ?? 0, r.stats?.unchanged ?? 0, r.stats?.reopened ?? 0, r.stats?.missingApplyUrl ?? 0, r.category ?? null, (r.error ?? r.stats?.closureSkipped ?? null)?.slice(0, 500) ?? null, Date.now() - t0, r.stats?.duplicatesDropped ?? 0],
    );
  };

  try {
    if (o.signal?.aborted) throw new IngestError("cancelled", "network");
    const provider = getProvider(row.provider);
    const res: ProviderFetchResult = await provider.fetchJobs(toJobSource(row), { signal: o.signal, maxPages: o.maxPages });
    const at = now();

    if (res.notModified) {
      await query(
        `UPDATE job_sources SET last_checked_at=$2, last_success_at=$2, next_check_at=$3, consecutive_failures=0, consecutive_rate_limits=0, status='active',
           last_error=NULL, last_error_category=NULL, last_http_status=304, etag=COALESCE($4, etag), last_modified=COALESCE($5, last_modified), locked_until=NULL, updated_at=now() WHERE id=$1`,
        [sourceId, at.toISOString(), nextCheckAfterSuccess(row, rnd, at).toISOString(), res.etag, res.lastModified],
      );
      await query("UPDATE company_jobs SET last_verified_at=$2, is_stale=false WHERE source_id=$1 AND status='active'", [sourceId, at.toISOString()]);
      await finish({ status: "not_modified", http: 304 });
      return { sourceId, status: "not_modified", fetched: 0, httpStatus: 304, durationMs: Date.now() - t0 };
    }

    const stats = await persistJobs({ id: sourceId, companySlug: row.company_slug, provider: row.provider, licenseClass: row.license_class, attribution: row.attribution }, res.jobs, { complete: res.complete });
    const partial = !res.complete || stats.closureSkipped !== null;
    await query(
      `UPDATE job_sources SET last_checked_at=$2, last_success_at=$2, next_check_at=$3, consecutive_failures=0, consecutive_rate_limits=0, status='active',
         last_error=$4, last_error_category=$5, last_http_status=$6, etag=$7, last_modified=$8, locked_until=NULL,
         last_sample=$9::jsonb, updated_at=now() WHERE id=$1`,
      [sourceId, at.toISOString(), nextCheckAfterSuccess(row, rnd, at).toISOString(), partial ? (res.incompleteReason ?? stats.closureSkipped) : null, partial ? "incomplete" : null, res.httpStatus, res.etag, res.lastModified,
        JSON.stringify({ at: at.toISOString(), httpStatus: res.httpStatus, pages: res.pages, complete: res.complete, incompleteReason: res.incompleteReason ?? null, fetched: res.jobs.length, skipped: res.skipped, sample: res.jobs.slice(0, 3).map((j) => ({ id: j.externalJobId, title: j.title, location: j.locationText, cityClass: j.cityClass, applyUrl: j.applyUrl, postedAt: j.postedAt })) })],
    );
    await query("UPDATE company_profiles SET last_jobs_fetch_at=$2, last_jobs_success_at=$2, last_jobs_error=NULL, last_jobs_error_category=NULL, last_http_status=$3, jobs_stale=false WHERE slug=$1", [row.company_slug, at.toISOString(), res.httpStatus]);
    await finish({ status: partial ? "partial" : "success", http: res.httpStatus, fetched: res.jobs.length, stats, error: res.incompleteReason });
    return { sourceId, status: partial ? "partial" : "success", stats, fetched: res.jobs.length, httpStatus: res.httpStatus, durationMs: Date.now() - t0 };
  } catch (e) {
    const ie = e instanceof IngestError ? e : new IngestError((e as Error).message?.slice(0, 200) ?? "unknown error", "network");
    if (o.signal?.aborted) {
      await query("UPDATE job_sources SET locked_until=NULL WHERE id=$1", [sourceId]);
      await finish({ status: "cancelled", error: "cancelled by shutdown" });
      return { sourceId, status: "cancelled", fetched: 0, httpStatus: null, durationMs: Date.now() - t0 };
    }
    // Failure: keep every job (flag as not re-checked), back off, and surface the reason. NEVER close anything here.
    const at = now();
    const failures = row.consecutive_failures + 1;
    const rateLimits = row.consecutive_rate_limits + (ie.category === "rate_limited" ? 1 : 0);
    let wait = backoffSeconds(failures, ie.retryAfterSeconds, rnd);
    if (SLOW_CATEGORIES.has(ie.category)) wait = Math.max(wait, 6 * 3600);
    const status = failures >= MAX_FAILURES_BEFORE_REVIEW || (ie.category === "not_found" && failures >= 5) ? "needs_review" : failures >= FAILING_AFTER ? "failing" : "active";
    await query(
      `UPDATE job_sources SET last_checked_at=$2, next_check_at=$3, consecutive_failures=$4, consecutive_rate_limits=$5, status=$6, last_error=$7, last_error_category=$8, last_http_status=$9, locked_until=NULL,
         last_sample=$10::jsonb, updated_at=now() WHERE id=$1`,
      [sourceId, at.toISOString(), new Date(at.getTime() + wait * 1000).toISOString(), failures, rateLimits, status, ie.message.slice(0, 300), ie.category, ie.status ?? null,
        JSON.stringify({ at: at.toISOString(), error: ie.message.slice(0, 300), category: ie.category, httpStatus: ie.status ?? null })],
    );
    await markSourceJobsStale(sourceId);
    await query("UPDATE company_profiles SET last_jobs_fetch_at=$2, last_jobs_error=$3, last_jobs_error_category=$4, last_http_status=$5, jobs_stale=true WHERE slug=$1", [row.company_slug, at.toISOString(), ie.message.slice(0, 200), ie.category, ie.status ?? null]);
    await finish({ status: "failed", http: ie.status ?? null, category: ie.category, error: ie.message });
    return { sourceId, status: "failed", category: ie.category, error: ie.message, fetched: 0, httpStatus: ie.status ?? null, durationMs: Date.now() - t0 };
  }
}
