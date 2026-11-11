// LEGACY, read-only. Drafting, sending and "I sent it myself" logging all live in lib/comms (one service).
// This file only lists messages recorded in outreach_messages before that move, so the history is not lost.
import { query } from "@/lib/database";
import type { AppUser } from "@/lib/users";

export interface ServiceResult {
  status: number;
  body: Record<string, unknown>;
}

/** Legacy route `/api/outreach/send` — sending now lives in lib/comms. */
export async function sendOutreach(_user: AppUser, _body: unknown): Promise<ServiceResult> {
  return { status: 410, body: { ok: false, error: "moved_to_comms" } };
}

export async function listMessages(user: AppUser, p: { startupId?: number; jobId?: number | null; status?: "draft" | "sent"; applicationId?: number }): Promise<ServiceResult> {
  const where = ["m.user_id = $1"];
  const params: unknown[] = [user.id];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (p.startupId) add("m.startup_id = ?", p.startupId);
  if (p.applicationId) add("m.application_id = ?", p.applicationId);
  if (p.status === "draft") where.push("m.status = 'draft'");
  if (p.status === "sent") where.push("m.status <> 'draft'");
  if (p.jobId !== undefined) add("COALESCE(m.job_id, 0) = ?", p.jobId ?? 0);
  const rows = await query(
    `SELECT m.*, s.name AS startup_name, j.job_title FROM outreach_messages m
     JOIN startups s ON s.id = m.startup_id LEFT JOIN jobs j ON j.id = m.job_id
     WHERE ${where.join(" AND ")} ORDER BY m.created_at DESC LIMIT 200`,
    params
  );
  return { status: 200, body: { messages: rows } };
}
