import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { query } from "@/lib/database";
import { parseDue, validTimezone } from "@/lib/career/reminders";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** PATCH { done?: boolean, title?, note?, due_at?, timezone? } */
export async function PATCH(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const b = await readJson<Record<string, any>>(req, 20_000);
  if (!id || !b) return err("invalid_request", 400);
  let due: Date | null = null;
  if (b.due_at !== undefined) {
    due = parseDue(b.due_at);
    if (!due) return err("invalid_request", 400, "Pick a valid date and time.");
  }
  const [r] = await query(
    `UPDATE career_reminders SET
       title = COALESCE(NULLIF($3, ''), title),
       note = CASE WHEN $4::boolean THEN $5 ELSE note END,
       due_at = COALESCE($6::timestamptz, due_at),
       timezone = CASE WHEN $6::timestamptz IS NULL THEN timezone ELSE $7 END,
       done_at = CASE WHEN $8::boolean IS NULL THEN done_at WHEN $8::boolean THEN COALESCE(done_at, now()) ELSE NULL END,
       updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING id, title, note, due_at, timezone, done_at`,
    [id, g.user.id, str(b.title, 160), b.note !== undefined, str(b.note, 2000), due ? due.toISOString() : null, validTimezone(b.timezone), typeof b.done === "boolean" ? b.done : null]
  );
  return r ? json({ reminder: r }) : err("not_found", 404);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const r = id ? await query("DELETE FROM career_reminders WHERE id = $1 AND user_id = $2 RETURNING id", [id, g.user.id]) : [];
  return r.length ? json({ ok: true }) : err("not_found", 404);
}
