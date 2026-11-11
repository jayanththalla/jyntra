import { NextResponse } from "next/server";
import { query } from "@/lib/database";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { patchApplication } from "@/lib/applications/store";

export const dynamic = "force-dynamic";

const validId = (id: string) => /^[1-9]\d{0,9}$/.test(id) && Number(id) < 2_147_483_647;

/** GET /api/applications/[id] — full application detail (same shape as the list endpoint, single row). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows = await query(
    `SELECT a.*, COALESCE(s.name, a.company_name) AS startup_name, s.website, s.linkedin_url, s.emails, COALESCE(j.job_title, a.role_title) AS job_title,
       COALESCE(j.job_url, a.application_url) AS job_url, j.source AS job_source, j.last_seen_at AS job_last_checked, j.is_active AS job_is_active,
       COALESCE(s.careers_url, s.website, s.source_url) AS careers_url,
       s.last_funding_date, s.funding_round, s.last_funding_amount, s.funding_source_url,
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
     WHERE a.user_id = $1 AND a.id = $2`,
    [user.id, Number(id)]
  );
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ application: rows[0] });
}

/** PATCH { status?, notes?, applied_at?, application_url?, outcome?, outcome_note? }. Outcomes are recorded only when the user sends them. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "write");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  let b: unknown;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const r = await patchApplication(user.id, Number(id), b as Record<string, unknown>);
  return r.ok ? NextResponse.json({ application: r.application }) : NextResponse.json({ error: r.error }, { status: r.status });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "write");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  await query("DELETE FROM applications WHERE id = $1 AND user_id = $2", [Number(id), user.id]);
  return NextResponse.json({ ok: true });
}
