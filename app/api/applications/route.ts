import { NextResponse } from "next/server";
import { query } from "@/lib/database";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { APPLICATION_STATUSES } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  const rows = await query(
    `SELECT a.*, COALESCE(s.name, a.company_name) AS startup_name, s.website, s.linkedin_url, s.emails, COALESCE(j.job_title, a.role_title) AS job_title,
       COALESCE(j.job_url, a.application_url) AS job_url, j.source AS job_source, j.last_seen_at AS job_last_checked, j.is_active AS job_is_active,
       COALESCE(s.careers_url, s.website, s.source_url) AS careers_url,
       s.last_funding_date, s.funding_round, s.last_funding_amount, s.funding_source_url,
       -- outreach history: messages sent through Jyntra or logged by the user (email_drafts) plus messages recorded before that service existed
       (SELECT COALESCE(json_agg(h ORDER BY h.at DESC), '[]'::json) FROM (
          SELECT d.id, d.kind AS channel, d.subject, d.body, d.to_email AS recipient_email, COALESCE(d.sent_at, d.updated_at) AS at,
                 CASE WHEN d.status = 'sent' AND d.via = 'manual' THEN 'logged_by_you' WHEN d.status = 'sent' THEN 'sent' ELSE d.status END AS state, d.via
            FROM email_drafts d WHERE d.user_id = a.user_id AND d.application_id = a.id
          UNION ALL
          SELECT m.id, m.channel, m.subject, m.body, m.recipient_email, m.created_at AS at, CASE WHEN m.delivery = 'manual' THEN 'logged_by_you' ELSE 'sent' END AS state, m.delivery AS via
            FROM outreach_messages m WHERE m.user_id = a.user_id AND m.status <> 'draft' AND (m.application_id = a.id OR (a.startup_id IS NOT NULL AND m.startup_id = a.startup_id))
       ) h) AS outreach,
       (SELECT count(*)::int FROM app_answer_sets w WHERE w.user_id = a.user_id AND w.application_id = a.id) AS answer_sets,
       (SELECT COALESCE(json_agg(r ORDER BY r.due_at), '[]'::json) FROM (SELECT id, title, due_at FROM career_reminders c WHERE c.user_id = a.user_id AND c.application_id = a.id AND c.done_at IS NULL) r) AS reminders
     FROM applications a LEFT JOIN startups s ON s.id = a.startup_id LEFT JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = $1
     ORDER BY a.updated_at DESC`,
    [user.id]
  );
  return NextResponse.json({ applications: rows });
}

/** POST { startup_id, job_id?, status? } — creates or updates the user's (startup, job) row. Used by "Save". */
export async function POST(req: Request) {
  const limited = rateLimit(req, "write");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  const b = await req.json();
  const status = b.status ?? "Saved";
  if (!APPLICATION_STATUSES.includes(status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
  if (!Number.isInteger(b.startup_id)) return NextResponse.json({ error: "startup_id required" }, { status: 400 });
  // application_url: only a URL we already hold for that job (never invented).
  const [job] = b.job_id ? await query("SELECT apply_url, job_url FROM jobs WHERE id = $1", [b.job_id]) : [null];
  const rows = await query(
    `INSERT INTO applications (user_id, startup_id, job_id, status, application_url, applied_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'Applied' THEN CURRENT_DATE END)
     ON CONFLICT (COALESCE(user_id, 0), startup_id, COALESCE(job_id, 0))
     DO UPDATE SET status = EXCLUDED.status, updated_at = now(),
       applied_at = COALESCE(applications.applied_at, EXCLUDED.applied_at)
     RETURNING *`,
    [user.id, b.startup_id, b.job_id ?? null, status, job?.apply_url ?? job?.job_url ?? null]
  );
  return NextResponse.json({ application: rows[0] });
}
