// Dashboard metrics, all computed from PostgreSQL. Nothing here is estimated or hard-coded.
//
// Definitions (also shown in the UI):
//  startups_total      distinct rows in `startups` (already de-duplicated by domain on ingest)
//  jobs_total          rows in `jobs` that are still active (is_active) — job_url is UNIQUE, so no repeats
//  saved_startups      this user's applications with no job (a company-level save)
//  saved_jobs          this user's applications tied to a job
//  status_breakdown    this user's applications grouped by their stored status
//  outreach_drafts     this user's outreach_messages with status 'draft'
//  outreach_sent       this user's outreach_messages with status other than 'draft'
//                      (rows are only written after a send succeeds, or when a user marks one sent)
//  followups_due       applications with status 'Applied', applied_at at least 7 days ago,
//                      and no SENT outreach message (drafts don't count) from this user to that startup in the last 7 days
//  funded_30/90        startups whose stored last_funding_date is inside the window (source dates)
//  funding_by_month    startups per calendar month of last_funding_date, last 6 months
// Matching counts (high-match etc.) come from the matcher on the client list, not SQL.
import { withTransaction } from "@/lib/database";

export const FOLLOW_UP_AFTER_DAYS = 7;

export interface Analytics {
  startups_total: number;
  jobs_total: number;
  saved_startups: number;
  saved_jobs: number;
  status_breakdown: Record<string, number>;
  outreach_drafts: number;
  outreach_sent: number;
  /** Of outreach_sent: messages the user told us they sent themselves (LinkedIn, Gmail compose, …), not sent by the app. */
  outreach_logged_manually: number;
  followups_due: number;
  /** People/companies you sent outreach to (distinct startups), and how many of them you recorded as replied / positive / a meaningful outcome in Applications. */
  outreach_contacted: number;
  outreach_replied: number;
  outreach_positive: number;
  outreach_meaningful: number;
  funded_30: number;
  funded_90: number;
  /** Startups whose funding date is known / unknown. Unknown dates are never counted in funded_30/90. */
  funding_dated_total: number;
  funding_undated_total: number;
  funding_by_month: { month: string; count: number }[];
  last_discovery_at: string | null;
}

/** Thrown for any database failure. The message is safe to show; the original error is only logged. */
export class AnalyticsUnavailableError extends Error {
  constructor() {
    super("analytics_unavailable");
  }
}

const n = (v: unknown) => Number(v ?? 0);

/**
 * All queries run in ONE read-only, repeatable-read transaction, so the numbers describe a single
 * consistent snapshot (e.g. saved + sent can't disagree because a row arrived mid-request).
 * Dates use the database session date (UTC on Render/Neon), the same clock that stamps applied_at.
 */
export async function loadAnalytics(userId: number): Promise<Analytics> {
  try {
    return await withTransaction(async (q) => {
      const [totals] = await q(`SELECT (SELECT count(*) FROM startups) AS startups, (SELECT count(*) FROM jobs WHERE is_active) AS jobs`);
      const statuses = await q(
        `SELECT status, count(*)::int AS c,
                count(*) FILTER (WHERE job_id IS NULL)::int AS company,
                count(*) FILTER (WHERE job_id IS NOT NULL)::int AS job
         FROM applications WHERE user_id = $1 GROUP BY status`,
        [userId]
      );
      // outreach_messages has no join here, so several messages to one startup can't multiply other counts.
      const [outreach] = await q(
        `SELECT count(*) FILTER (WHERE status = 'draft')::int AS drafts,
                count(*) FILTER (WHERE status <> 'draft')::int AS sent,
                count(*) FILTER (WHERE status <> 'draft' AND delivery = 'manual')::int AS manual
         FROM outreach_messages WHERE user_id = $1`,
        [userId]
      );
      // EXISTS (not JOIN): an application is counted once however many messages exist.
      const [follow] = await q(
        `SELECT count(*)::int AS c FROM applications a
         WHERE a.user_id = $1 AND a.status = 'Applied' AND a.applied_at IS NOT NULL
           AND a.applied_at <= (CURRENT_DATE - $2::int)
           AND NOT EXISTS (SELECT 1 FROM outreach_messages m
                           WHERE m.user_id = a.user_id AND m.startup_id = a.startup_id AND m.status <> 'draft'
                             AND m.created_at > now() - make_interval(days => $2::int))`,
        [userId, FOLLOW_UP_AFTER_DAYS]
      );
      // Distinct startups, so several messages or applications to one company count once. Only outcomes the user recorded are counted.
      const [res] = await q(
        `SELECT count(DISTINCT m.startup_id)::int AS contacted,
                count(DISTINCT a.startup_id) FILTER (WHERE a.outcome IN ('replied','interview_scheduled','rejected','offer','accepted','declined'))::int AS replied,
                count(DISTINCT a.startup_id) FILTER (WHERE a.outcome IN ('replied','interview_scheduled','offer','accepted'))::int AS positive,
                count(DISTINCT a.startup_id) FILTER (WHERE a.outcome IN ('interview_scheduled','offer','accepted'))::int AS meaningful
         FROM outreach_messages m LEFT JOIN applications a ON a.user_id = m.user_id AND a.startup_id = m.startup_id
         WHERE m.user_id = $1 AND m.status <> 'draft'`,
        [userId]
      );
      const [funding] = await q(
        `SELECT count(*) FILTER (WHERE last_funding_date >= CURRENT_DATE - 30 AND last_funding_date <= CURRENT_DATE)::int AS d30,
                count(*) FILTER (WHERE last_funding_date >= CURRENT_DATE - 90 AND last_funding_date <= CURRENT_DATE)::int AS d90,
                count(*) FILTER (WHERE last_funding_date IS NOT NULL)::int AS dated,
                count(*) FILTER (WHERE last_funding_date IS NULL)::int AS undated
         FROM startups`
      );
      const months = await q(
        `SELECT to_char(date_trunc('month', last_funding_date), 'YYYY-MM') AS month, count(*)::int AS count
         FROM startups
         WHERE last_funding_date >= date_trunc('month', CURRENT_DATE) - interval '5 months' AND last_funding_date <= CURRENT_DATE
         GROUP BY 1 ORDER BY 1`
      );
      const [run] = await q(`SELECT finished_at FROM discovery_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1`);

      const status_breakdown: Record<string, number> = {};
      let saved_startups = 0;
      let saved_jobs = 0;
      for (const r of statuses) {
        status_breakdown[r.status] = n(r.c);
        saved_startups += n(r.company);
        saved_jobs += n(r.job);
      }
      return {
        startups_total: n(totals?.startups),
        jobs_total: n(totals?.jobs),
        saved_startups,
        saved_jobs,
        status_breakdown,
        outreach_drafts: n(outreach?.drafts),
        outreach_sent: n(outreach?.sent),
        outreach_logged_manually: n(outreach?.manual),
        followups_due: n(follow?.c),
        outreach_contacted: n(res?.contacted),
        outreach_replied: n(res?.replied),
        outreach_positive: n(res?.positive),
        outreach_meaningful: n(res?.meaningful),
        funded_30: n(funding?.d30),
        funded_90: n(funding?.d90),
        funding_dated_total: n(funding?.dated),
        funding_undated_total: n(funding?.undated),
        funding_by_month: months.map((m: { month: string; count: number }) => ({ month: m.month, count: n(m.count) })),
        last_discovery_at: run?.finished_at ? new Date(run.finished_at).toISOString() : null,
      };
    }, { readOnly: true });
  } catch (e) {
    console.error("[analytics] query failed:", (e as Error).message); // server log only
    throw new AnalyticsUnavailableError();
  }
}
