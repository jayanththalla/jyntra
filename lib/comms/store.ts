// Persistence for email drafts and connected accounts. EVERY function takes userId and filters on it.
import crypto from "node:crypto";
import { query } from "@/lib/database";
import type { DraftInput } from "./validate";

export interface DraftRow {
  id: number; user_id: number; kind: string; to_email: string | null; recipient_name: string | null; cc: string[]; subject: string; body: string;
  status: "draft" | "sending" | "sent" | "failed" | "unknown"; application_id: number | null; startup_id: number | null; job_id: number | null;
  context: Record<string, unknown>; citations: unknown[]; via: string | null; from_email: string | null; provider_message_id: string | null;
  error_code: string | null; attempts: number; sent_at: string | null; created_at: string; updated_at: string;
}
/** What the browser may see: everything except internal bookkeeping. */
export const publicDraft = (d: DraftRow) => { const { user_id: _u, ...rest } = d; return rest; };

/** Hash of exactly what would be sent. The preview returns it and the send must echo it: the message sent is the message the user saw. */
export const contentHash = (d: Pick<DraftRow, "to_email" | "cc" | "subject" | "body">) =>
  crypto.createHash("sha256").update(JSON.stringify([d.to_email ?? "", [...d.cc], d.subject, d.body]), "utf8").digest("hex");

const COLS = "id, user_id, kind, to_email, recipient_name, cc, subject, body, status, application_id, startup_id, job_id, context, citations, via, from_email, provider_message_id, error_code, attempts, sent_at, created_at, updated_at";

/** Linked ids must belong to this user (applications) or exist (shared startups/jobs); otherwise they are dropped, never trusted. */
async function ownedLinks(userId: number, d: Pick<DraftInput, "application_id" | "startup_id" | "job_id">) {
  const [a] = d.application_id ? await query("SELECT id FROM applications WHERE id = $1 AND user_id = $2", [d.application_id, userId]) : [null];
  const [s] = d.startup_id ? await query("SELECT id FROM startups WHERE id = $1", [d.startup_id]) : [null];
  const [j] = d.job_id ? await query("SELECT id FROM jobs WHERE id = $1", [d.job_id]) : [null];
  return { application_id: a?.id ?? null, startup_id: s?.id ?? null, job_id: j?.id ?? null };
}

export async function createDraft(userId: number, d: DraftInput, extra: { context?: Record<string, unknown>; citations?: unknown[] } = {}): Promise<DraftRow> {
  const l = await ownedLinks(userId, d);
  const [r] = await query<DraftRow>(
    `INSERT INTO email_drafts (user_id, kind, to_email, recipient_name, cc, subject, body, application_id, startup_id, job_id, context, citations)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${COLS}`,
    [userId, d.kind, d.to_email, d.recipient_name, d.cc, d.subject, d.body, l.application_id, l.startup_id, l.job_id, JSON.stringify(extra.context ?? {}), JSON.stringify(extra.citations ?? [])]
  );
  return r;
}

export async function getDraft(userId: number, id: number): Promise<DraftRow | null> {
  const [r] = await query<DraftRow>(`SELECT ${COLS} FROM email_drafts WHERE id = $1 AND user_id = $2`, [id, userId]);
  return r ?? null;
}

export async function listDrafts(userId: number, p: { status?: "open" | "sent"; limit?: number; offset?: number; startupId?: number | null; applicationId?: number | null } = {}) {
  const where = (p.status === "sent" ? "AND status = 'sent'" : p.status === "open" ? "AND status <> 'sent'" : "") + (p.startupId ? " AND startup_id = $4" : "") + (p.applicationId ? ` AND application_id = $${p.startupId ? 5 : 4}` : "");
  const extra = [p.startupId, p.applicationId].filter((x): x is number => !!x);
  return query<DraftRow>(`SELECT ${COLS} FROM email_drafts WHERE user_id = $1 ${where} ORDER BY updated_at DESC LIMIT $2 OFFSET $3`, [userId, Math.min(Math.max(p.limit ?? 30, 1), 50), Math.max(p.offset ?? 0, 0), ...extra]);
}

/** Only drafts that have not been claimed for sending can be edited: a message in flight or already sent is history. */
export async function updateDraft(userId: number, id: number, d: DraftInput): Promise<DraftRow | null> {
  const l = await ownedLinks(userId, d);
  const [r] = await query<DraftRow>(
    `UPDATE email_drafts SET kind = $3, to_email = $4, recipient_name = $5, cc = $6, subject = $7, body = $8, application_id = $9, startup_id = $10, job_id = $11,
       status = CASE WHEN status = 'failed' THEN 'draft' ELSE status END, error_code = CASE WHEN status = 'unknown' THEN error_code ELSE NULL END, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status IN ('draft','failed','unknown') RETURNING ${COLS}`,
    [id, userId, d.kind, d.to_email, d.recipient_name, d.cc, d.subject, d.body, l.application_id, l.startup_id, l.job_id]
  );
  return r ?? null;
}

/** Sent messages are never deleted from here (they are the user's record); drafts and failed attempts can be. */
export const deleteDraft = async (userId: number, id: number) => (await query("DELETE FROM email_drafts WHERE id = $1 AND user_id = $2 AND status IN ('draft','failed','unknown') RETURNING id", [id, userId])).length > 0;

// ---- accounts ----
export interface AccountRow { id: number; user_id: number; provider: string; email: string; refresh_token_enc: string | null; status: string; last_error: string | null; connected_at: string }
export const publicAccount = (a: AccountRow) => ({ id: a.id, provider: a.provider, email: a.email, status: a.status, last_error: a.last_error, connected_at: a.connected_at });

export async function getAccount(userId: number): Promise<AccountRow | null> {
  const [a] = await query<AccountRow>("SELECT * FROM email_accounts WHERE user_id = $1 AND provider = 'gmail_oauth'", [userId]);
  return a ?? null;
}
export async function upsertAccount(userId: number, email: string, refreshEnc: string) {
  const [a] = await query<AccountRow>(
    `INSERT INTO email_accounts (user_id, provider, email, refresh_token_enc, status, last_error, connected_at) VALUES ($1,'gmail_oauth',$2,$3,'connected',NULL,now())
     ON CONFLICT (user_id, provider) DO UPDATE SET email = EXCLUDED.email, refresh_token_enc = EXCLUDED.refresh_token_enc, status = 'connected', last_error = NULL, connected_at = now() RETURNING *`,
    [userId, email, refreshEnc]
  );
  return a;
}
/** The provider said the grant is gone: keep the row (so the UI can say "reconnect") but drop the token. */
export const markAccountRevoked = (userId: number, id: number, why: string) => query("UPDATE email_accounts SET status = 'revoked', refresh_token_enc = NULL, last_error = $3 WHERE id = $1 AND user_id = $2", [id, userId, why]);
export const removeAccount = async (userId: number, id: number): Promise<AccountRow | null> => {
  const [a] = await query<AccountRow>("DELETE FROM email_accounts WHERE id = $1 AND user_id = $2 RETURNING *", [id, userId]);
  return a ?? null;
};
