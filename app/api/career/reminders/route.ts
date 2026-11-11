// Follow-up reminders (in-app only). Every query is scoped to the signed-in user.
import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { query } from "@/lib/database";
import { parseDue, validTimezone } from "@/lib/career/reminders";

export const dynamic = "force-dynamic";
const COLS = `r.id, r.application_id, r.draft_id, r.title, r.note, r.due_at, r.timezone, r.done_at, r.created_at,
  COALESCE(s.name, a.company_name) AS company, COALESCE(j.job_title, a.role_title) AS role`;
const FROM = `FROM career_reminders r LEFT JOIN applications a ON a.id = r.application_id LEFT JOIN startups s ON s.id = a.startup_id LEFT JOIN jobs j ON j.id = a.job_id`;

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const rows = await query(`SELECT ${COLS} ${FROM} WHERE r.user_id = $1 ORDER BY (r.done_at IS NOT NULL), r.due_at ASC LIMIT 300`, [g.user.id]);
  return json({ reminders: rows });
}

export async function POST(req: Request) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const b = await readJson<Record<string, any>>(req, 20_000);
  if (!b) return err("invalid_request", 400);
  const title = str(b.title, 160);
  if (!title) return err("invalid_request", 400, "Give the reminder a title.");
  const due = parseDue(b.due_at);
  if (!due) return err("invalid_request", 400, "Pick a valid date and time.");
  const appId = toId(b.application_id);
  if (appId) {
    const [a] = await query("SELECT id FROM applications WHERE id = $1 AND user_id = $2", [appId, g.user.id]);
    if (!a) return err("not_found", 404, "Application not found.");
  }
  const draftId = toId(b.draft_id);
  if (draftId) {
    const [d] = await query("SELECT id FROM email_drafts WHERE id = $1 AND user_id = $2", [draftId, g.user.id]);
    if (!d) return err("not_found", 404, "Email draft not found.");
  }
  const [r] = await query<{ id: number }>(
    "INSERT INTO career_reminders (user_id, application_id, draft_id, title, note, due_at, timezone) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [g.user.id, appId, draftId, title, str(b.note, 2000), due.toISOString(), validTimezone(b.timezone)]
  );
  const [row] = await query(`SELECT ${COLS} ${FROM} WHERE r.id = $1 AND r.user_id = $2`, [r.id, g.user.id]);
  return json({ reminder: row }, 201);
}
