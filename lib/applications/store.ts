// Updating one of the user's applications. Every statement filters on user_id: another user's id changes nothing.
import { query } from "@/lib/database";
import { APPLICATION_STATUSES } from "@/lib/types";
import { parseOutcome, STATUS_FOR_OUTCOME } from "./outcome";

export type PatchResult = { ok: true; application: Record<string, unknown> } | { ok: false; status: number; error: string };

export async function patchApplication(userId: number, id: number, b: Record<string, any>): Promise<PatchResult> {
  const oc = b.outcome !== undefined ? parseOutcome(b.outcome) : null;
  if (oc && !oc.ok) return { ok: false, status: 400, error: "bad outcome" };
  if (b.outcome_note !== undefined && b.outcome_note !== null && (typeof b.outcome_note !== "string" || b.outcome_note.length > 2000)) return { ok: false, status: 400, error: "bad outcome_note" };
  let status: string | undefined = b.status;
  // The status follows an outcome only because the USER recorded that outcome in this request.
  if (oc && oc.ok && oc.value && !status && STATUS_FOR_OUTCOME[oc.value]) status = STATUS_FOR_OUTCOME[oc.value]!;
  if (status !== undefined && !(APPLICATION_STATUSES as readonly string[]).includes(status)) return { ok: false, status: 400, error: "bad status" };
  const rows = await query(
    `UPDATE applications SET
       status = COALESCE($2, status),
       notes = CASE WHEN $3::boolean THEN $4 ELSE notes END,
       application_url = CASE WHEN $5::boolean THEN $6 ELSE application_url END,
       applied_at = CASE WHEN $7::boolean THEN $8::date WHEN $2 = 'Applied' AND applied_at IS NULL THEN CURRENT_DATE ELSE applied_at END,
       outcome = CASE WHEN $10::boolean THEN $11 ELSE outcome END,
       outcome_note = CASE WHEN $12::boolean THEN $13 ELSE outcome_note END,
       outcome_at = CASE WHEN $10::boolean THEN (CASE WHEN $11::text IS NULL THEN NULL ELSE now() END) ELSE outcome_at END,
       updated_at = now()
     WHERE id = $1 AND user_id = $9 RETURNING *`,
    [id, status ?? null, b.notes !== undefined, b.notes ?? null, b.application_url !== undefined, b.application_url || null, b.applied_at !== undefined, b.applied_at || null, userId,
     oc !== null, oc && oc.ok ? oc.value : null, b.outcome_note !== undefined, b.outcome_note || null]
  );
  return rows[0] ? { ok: true, application: rows[0] } : { ok: false, status: 404, error: "not found" };
}
