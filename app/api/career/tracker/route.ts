// Read-only roll-up for the Atlas Tracker tab. Every figure comes from the user's own rows; nothing is estimated.
import { guard, json } from "@/lib/kb/api";
import { query } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const u = g.user.id;
  const [pipeline, emails, recentEmails, answers, reminders, stale, notes] = await Promise.all([
    query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM applications WHERE user_id = $1 GROUP BY status", [u]),
    query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM email_drafts WHERE user_id = $1 GROUP BY status", [u]),
    query(`SELECT d.id, d.subject, d.to_email, d.status, d.sent_at, d.updated_at, COALESCE(s.name, a.company_name) AS company
           FROM email_drafts d LEFT JOIN applications a ON a.id = d.application_id LEFT JOIN startups s ON s.id = a.startup_id
           WHERE d.user_id = $1 ORDER BY d.updated_at DESC LIMIT 8`, [u]),
    query<{ sets: number; total: number; complete: number; needs_input: number }>(
      `SELECT (SELECT count(*)::int FROM app_answer_sets WHERE user_id = $1) AS sets,
              count(*)::int AS total, count(*) FILTER (WHERE status = 'complete')::int AS complete, count(*) FILTER (WHERE status = 'needs_input')::int AS needs_input
       FROM app_answers WHERE user_id = $1`, [u]),
    query<{ overdue: number; today: number; upcoming: number; done: number }>(
      `SELECT count(*) FILTER (WHERE done_at IS NULL AND due_at < now())::int AS overdue,
              count(*) FILTER (WHERE done_at IS NULL AND due_at >= now() AND due_at < now() + interval '24 hours')::int AS today,
              count(*) FILTER (WHERE done_at IS NULL AND due_at >= now() + interval '24 hours')::int AS upcoming,
              count(*) FILTER (WHERE done_at IS NOT NULL)::int AS done
       FROM career_reminders WHERE user_id = $1`, [u]),
    // Applied 7+ days ago, nothing newer than the application date, and no open reminder: a follow-up may be worth scheduling.
    query(`SELECT a.id, COALESCE(s.name, a.company_name) AS company, COALESCE(j.job_title, a.role_title) AS role, a.applied_at
           FROM applications a LEFT JOIN startups s ON s.id = a.startup_id LEFT JOIN jobs j ON j.id = a.job_id
           WHERE a.user_id = $1 AND a.status = 'Applied' AND a.applied_at IS NOT NULL AND a.applied_at <= CURRENT_DATE - 7
             AND NOT EXISTS (SELECT 1 FROM career_reminders r WHERE r.application_id = a.id AND r.user_id = a.user_id AND r.done_at IS NULL)
           ORDER BY a.applied_at ASC LIMIT 10`, [u]),
    query<{ n: number }>("SELECT count(*)::int AS n FROM kb_notes WHERE user_id = $1", [u]),
  ]);
  return json({
    pipeline: Object.fromEntries(pipeline.map((r) => [r.status, r.n])),
    emails: Object.fromEntries(emails.map((r) => [r.status, r.n])),
    recent_emails: recentEmails,
    answers: answers[0] ?? { sets: 0, total: 0, complete: 0, needs_input: 0 },
    reminders: reminders[0] ?? { overdue: 0, today: 0, upcoming: 0, done: 0 },
    needs_follow_up: stale,
    saved_notes: notes[0]?.n ?? 0,
  });
}
