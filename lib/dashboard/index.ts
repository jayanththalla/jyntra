// Dashboard read model: recommended individual jobs, four user-specific metrics, data freshness, next actions.
// Pure selection logic is separate from the database reads so it can be unit-tested.
import { query } from "@/lib/database";
import { loadStartups } from "@/lib/discovery/read";
import { inPostedWindow } from "@/lib/jobs/age";
import type { AppUser } from "@/lib/users";
import type { JobView, StartupView } from "@/lib/types";

export const FOLLOW_UP_AFTER_DAYS = 7;

export interface RecommendedJob { job: JobView; company: { id: number; name: string } }

/** New-this-week jobs that fit the profile and are not already tracked by this user; best fit first. */
export function recommendJobs(startups: StartupView[], limit = 6): { picks: RecommendedJob[]; total: number } {
  const rows: RecommendedJob[] = [];
  for (const s of startups) {
    const tracked = new Set(s.applications.map((a) => a.job_id).filter(Boolean));
    for (const j of s.jobs) {
      if (tracked.has(j.id)) continue;
      if (j.match.relevance !== "strong" && j.match.relevance !== "potential") continue;
      if (!inPostedWindow(j.recency, "week")) continue;
      rows.push({ job: j, company: { id: s.id, name: s.name } });
    }
  }
  rows.sort((a, b) => b.job.match.match_score - a.job.match.match_score);
  return { picks: rows.slice(0, limit), total: rows.length };
}

export interface DashboardMetrics { new_matches: number; to_apply: number; in_progress: number; follow_ups_due: number }
export interface NextAction { kind: "reminder" | "follow_up" | "draft" | "profile"; text: string; href: string }

export async function loadDashboard(user: AppUser) {
  const startups = await loadStartups(user, { slim: true });
  const { picks, total } = recommendJobs(startups);
  const [counts] = await query<{ to_apply: number; in_progress: number }>(
    `SELECT count(*) FILTER (WHERE status IN ('Saved','Not Applied'))::int AS to_apply,
            count(*) FILTER (WHERE status IN ('Applied','Interview'))::int AS in_progress
     FROM applications WHERE user_id = $1`, [user.id]);
  const reminders = await query<{ id: number; title: string; application_id: number | null }>(
    `SELECT id, title, application_id FROM career_reminders WHERE user_id = $1 AND done_at IS NULL AND due_at <= now() ORDER BY due_at LIMIT 5`, [user.id]);
  const stale = await query<{ id: number; name: string | null; role: string | null }>(
    `SELECT a.id, COALESCE(s.name, a.company_name) AS name, COALESCE(j.job_title, a.role_title) AS role
     FROM applications a LEFT JOIN startups s ON s.id = a.startup_id LEFT JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = $1 AND a.status = 'Applied' AND a.applied_at <= (CURRENT_DATE - $2::int)
       AND NOT EXISTS (SELECT 1 FROM email_drafts d WHERE d.user_id = a.user_id AND d.application_id = a.id AND d.status = 'sent' AND d.sent_at > now() - make_interval(days => $2::int))
     ORDER BY a.applied_at LIMIT 5`, [user.id, FOLLOW_UP_AFTER_DAYS]);
  const [drafts] = await query<{ n: number }>("SELECT count(*)::int AS n FROM email_drafts WHERE user_id = $1 AND status IN ('draft','failed','unknown')", [user.id]);
  const [run] = await query<{ finished_at: Date | null }>("SELECT finished_at FROM discovery_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1");

  const actions: NextAction[] = [];
  const p = user.profile;
  if (!p.explorer && (!(p.target_roles?.length) || !(p.skills?.length))) actions.push({ kind: "profile", text: "Add target roles and skills so fit scores mean something", href: "/settings" });
  // Tracker reminders, follow-ups and drafts are not surfaced: the Applications page is hidden.

  const metrics: DashboardMetrics = { new_matches: total, to_apply: counts?.to_apply ?? 0, in_progress: counts?.in_progress ?? 0, follow_ups_due: reminders.length + stale.length };
  return { picks, metrics, actions: actions.slice(0, 6), last_discovery_at: run?.finished_at ? new Date(run.finished_at).toISOString() : null, name: p.name ?? null };
}
