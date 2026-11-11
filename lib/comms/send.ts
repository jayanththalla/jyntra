// Sending an email draft. The rules, in the order they are enforced:
//   1. Nothing is sent without `confirm: true` AND the content hash of the exact message the user previewed.
//   2. The draft is CLAIMED atomically (draft|failed -> sending, row locked), so a double-click, a retry or two tabs cannot send twice.
//   3. "sent" is recorded only after the provider returned its own message id.
//   4. If the provider answered with an error, nothing was sent: the draft becomes "failed" and can be retried.
//      If we never heard back, the draft becomes "unknown": it is NOT retried until the user acknowledges it may be a duplicate.
//   5. Credentials are decrypted for the instant of use, never logged, never returned.
import { query, withTransaction } from "@/lib/database";
import { sendPersonalGmail, type SendEmailOptions, type SendResult } from "@/lib/outreach/sender";
import { resolveGmailPassword } from "@/lib/secrets/gmail";
import { open, VaultDecryptError, VaultNotConfigured } from "@/lib/secrets/vault";
import type { AppUser } from "@/lib/users";
import { GmailError, refreshAccessToken, sendGmail, type GmailErrorCode } from "./gmail";
import { contentHash, getAccount, getDraft, markAccountRevoked, publicDraft, type AccountRow, type DraftRow } from "./store";
import { validateDraft } from "./validate";

export interface SendDeps {
  gmailSend?: typeof sendGmail;
  refresh?: typeof refreshAccessToken;
  smtpSend?: (o: SendEmailOptions) => Promise<SendResult>;
  sleep?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
}
export interface ServiceResult { status: number; body: Record<string, unknown> }

export const DAILY_SEND_CAP = 40;
const STALE_SENDING_MINUTES = 3;
const MAX_ATTEMPTS = 3;

const MESSAGES: Record<string, string> = {
  reconnect_required: "Google no longer accepts this connection. Reconnect your Gmail account, then send again. Nothing was sent.",
  rate_limited: "Gmail is limiting sends right now. Nothing was sent; try again in a few minutes.",
  provider_unavailable: "Gmail is having a problem. Nothing was sent; try again shortly.",
  invalid_message: "Gmail refused this message (check the recipient address and subject). Nothing was sent.",
  no_response: "We lost contact with Gmail while sending, so we can't tell whether this message left. Check your Sent folder before sending again.",
  not_configured: "Email sending isn't set up on this server (missing Google credentials or the credential encryption key).",
  scope_missing: "Gmail didn't grant permission to send. Reconnect and allow sending.",
  not_connected: "Connect a Gmail account first (Email settings), or add your Gmail address and App Password in Settings.",
  smtp_failed: "Gmail could not send this message. Nothing was sent.",
};
export const sendErrorMessage = (code: string) => MESSAGES[code] ?? "The message could not be sent. Nothing was sent.";

type Sender = { via: "gmail_api"; account: AccountRow; refreshToken: string; from: string } | { via: "smtp"; from: string; pass: string } | { error: string; status: number };

/** Which mailbox would send: a connected Gmail account first, else the user's own Gmail App Password. Never a server-wide mailbox. */
export async function resolveSender(user: AppUser, env: Record<string, string | undefined> = process.env): Promise<Sender> {
  const account = await getAccount(user.id);
  if (account && account.status === "connected" && account.refresh_token_enc) {
    try {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return { error: "not_configured", status: 503 };
      return { via: "gmail_api", account, refreshToken: open(account.refresh_token_enc, "gmail-oauth", user.id, env), from: account.email };
    } catch (e) {
      if (e instanceof VaultNotConfigured) return { error: "not_configured", status: 503 };
      if (e instanceof VaultDecryptError) return { error: "reconnect_required", status: 422 };
      throw e;
    }
  }
  if (account && account.status === "revoked" && !user.profile.gmail_user) return { error: "reconnect_required", status: 422 };
  const cred = resolveGmailPassword(user.id, user.profile, env);
  if (user.profile.gmail_user && cred.ok) return { via: "smtp", from: user.profile.gmail_user, pass: cred.pass };
  if (!cred.ok && cred.reason === "not_configured") return { error: "not_configured", status: 503 };
  return { error: "not_connected", status: 422 };
}

/** Read-only: exactly what would be sent, from where, and the hash to echo back when the user confirms. Sends nothing, records nothing. */
export async function previewDraft(user: AppUser, id: number, deps: Pick<SendDeps, "env"> = {}): Promise<ServiceResult> {
  const d = await getDraft(user.id, id);
  if (!d) return { status: 404, body: { error: "not_found" } };
  const problems: string[] = [];
  const v = validateDraft(d, "send");
  if (!v.ok) problems.push(v.error);
  const s = await resolveSender(user, deps.env);
  if ("error" in s) problems.push(s.error);
  return { status: 200, body: { draft: publicDraft(d), from: "error" in s ? null : s.from, via: "error" in s ? null : s.via, content_hash: contentHash(d), ready: problems.length === 0 && d.status !== "sent" && d.status !== "sending", problems, already_sent: d.status === "sent" } };
}

async function finish(userId: number, id: number, fields: { status: "sent" | "failed" | "unknown"; code?: string | null; via?: string; from?: string; messageId?: string | null; threadId?: string | null }) {
  await query(
    `UPDATE email_drafts SET status = $3, error_code = $4, via = COALESCE($5, via), from_email = COALESCE($6, from_email), provider_message_id = $7, provider_thread_id = $8,
       sent_at = CASE WHEN $3 = 'sent' THEN now() ELSE sent_at END, updated_at = now() WHERE id = $1 AND user_id = $2`,
    [id, userId, fields.status, fields.code ?? null, fields.via ?? null, fields.from ?? null, fields.messageId ?? null, fields.threadId ?? null]
  );
}

export async function sendDraft(user: AppUser, id: number, p: { confirm: unknown; contentHash: unknown; acknowledgeUnknown?: unknown }, deps: SendDeps = {}): Promise<ServiceResult> {
  if (p.confirm !== true) return { status: 400, body: { ok: false, error: "confirmation_required", message: "Review the message and confirm the recipient before sending." } };
  if (typeof p.contentHash !== "string" || !p.contentHash) return { status: 400, body: { ok: false, error: "preview_required", message: "Preview the final message first." } };
  const env = deps.env ?? process.env;

  // A claim older than a few minutes means a send died halfway: its outcome is unknown, so it is parked, not retried.
  await query(`UPDATE email_drafts SET status = 'unknown', error_code = 'no_response', updated_at = now() WHERE id = $1 AND user_id = $2 AND status = 'sending' AND claimed_at < now() - ($3 || ' minutes')::interval`, [id, user.id, String(STALE_SENDING_MINUTES)]);

  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM email_drafts WHERE user_id = $1 AND status = 'sent' AND COALESCE(via, '') <> 'manual' AND sent_at > now() - interval '24 hours'", [user.id]);
  if (n >= DAILY_SEND_CAP) return { status: 429, body: { ok: false, error: "daily_limit", message: `You've reached ${DAILY_SEND_CAP} sent emails in 24 hours. This protects your mailbox from being flagged as spam.` } };

  const sender = await resolveSender(user, env);
  if ("error" in sender) return { status: sender.status, body: { ok: false, error: sender.error, message: sendErrorMessage(sender.error) } };

  // Claim: lock the row, check it, flip it to "sending". Only one caller can win.
  type Claim = { early?: ServiceResult; draft?: DraftRow };
  const claim = await withTransaction<Claim>(async (q) => {
    const [d] = await q<DraftRow>("SELECT * FROM email_drafts WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, user.id]);
    if (!d) return { early: { status: 404, body: { ok: false, error: "not_found" } } };
    if (d.status === "sent") return { early: { status: 200, body: { ok: true, duplicate: true, sent: true, draft: publicDraft(d), message: "This message was already sent. It was not sent again." } } };
    if (d.status === "sending") return { early: { status: 409, body: { ok: false, error: "in_progress", message: "This message is being sent right now." } } };
    if (d.status === "unknown" && p.acknowledgeUnknown !== true) return { early: { status: 409, body: { ok: false, error: "unknown_outcome", message: sendErrorMessage("no_response"), needs_acknowledgement: true } } };
    const v = validateDraft(d, "send");
    if (!v.ok) return { early: { status: 400, body: { ok: false, error: v.error } } };
    if (contentHash(d) !== p.contentHash) return { early: { status: 409, body: { ok: false, error: "content_changed", message: "The draft changed after you previewed it. Preview the final message again." } } };
    await q("UPDATE email_drafts SET status = 'sending', claimed_at = now(), attempts = attempts + 1, error_code = NULL, updated_at = now() WHERE id = $1 AND user_id = $2", [id, user.id]);
    return { draft: d };
  });
  if (claim.early) return claim.early;
  const d = claim.draft!;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let result: { messageId: string | null; threadId: string | null } | null = null;
  let failure: { code: GmailErrorCode | "smtp_failed"; status: "failed" | "unknown" } | null = null;

  if (sender.via === "gmail_api") {
    const clientId = env.GOOGLE_CLIENT_ID!, clientSecret = env.GOOGLE_CLIENT_SECRET!;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !result; attempt++) {
      try {
        const accessToken = await (deps.refresh ?? refreshAccessToken)({ clientId, clientSecret, refreshToken: sender.refreshToken });
        const r = await (deps.gmailSend ?? sendGmail)({ accessToken, from: sender.from, fromName: user.profile.name, to: d.to_email!, cc: d.cc, subject: d.subject, text: d.body });
        result = { messageId: r.id, threadId: r.threadId };
      } catch (e) {
        const code: GmailErrorCode = e instanceof GmailError ? e.code : "provider_unavailable";
        const recoverable = code === "rate_limited" || code === "provider_unavailable";
        if (recoverable && attempt < MAX_ATTEMPTS) { await sleep(Math.min((e as GmailError).retryAfterMs ?? 1000 * 2 ** (attempt - 1), 5000)); continue; }
        failure = { code, status: code === "no_response" ? "unknown" : "failed" };
        break;
      }
    }
    if (failure?.code === "reconnect_required") await markAccountRevoked(user.id, sender.account.id, "reconnect_required").catch(() => {});
  } else {
    const r = await (deps.smtpSend ?? sendPersonalGmail)({ to: d.to_email!, cc: d.cc, subject: d.subject, text: d.body, fromName: user.profile.name, credentials: { user: sender.from, pass: sender.pass } });
    if (r.ok) result = { messageId: r.messageId ?? null, threadId: null };
    else failure = { code: "smtp_failed", status: "failed" }; // the SMTP sender reports "Nothing was sent" only for refusals it can tell apart
  }

  if (result) {
    try {
      await finish(user.id, id, { status: "sent", via: sender.via, from: sender.from, messageId: result.messageId, threadId: result.threadId });
    } catch (e) {
      console.error("[comms/send] sent but could not record:", (e as Error).name); // the mail HAS left: say so
      return { status: 200, body: { ok: true, sent: true, recorded: false, warning: "The email was sent, but we couldn't update its status here. Don't send it again." } };
    }
    await linkApplication(user.id, id).catch((e) => console.error("[comms/send] could not link to an application:", (e as Error).name)); // the mail HAS left; linking is best effort
    return { status: 200, body: { ok: true, sent: true, recorded: true, via: sender.via, from: sender.from, provider_message_id: result.messageId, draft: publicDraft((await getDraft(user.id, id))!) } };
  }
  const f = failure!;
  await finish(user.id, id, { status: f.status, code: f.code }).catch(() => {});
  console.warn(`[comms/send] draft ${id} ${f.status}: ${f.code}`); // code only: never recipients, bodies or tokens
  return { status: f.code === "rate_limited" ? 429 : f.status === "unknown" ? 502 : f.code === "not_configured" ? 503 : 422, body: { ok: false, sent: false, error: f.code, status: f.status, retryable: f.status === "failed" && (f.code === "rate_limited" || f.code === "provider_unavailable" || f.code === "smtp_failed"), message: sendErrorMessage(f.code), draft: publicDraft((await getDraft(user.id, id))!) } };
}

/**
 * Puts a sent message on the user's application for that company/job so Applications shows the whole history.
 * Creates a plain "Saved" entry when none exists. NEVER changes an existing status: contacting a founder is not applying.
 */
export async function linkApplication(userId: number, draftId: number): Promise<number | null> {
  return withTransaction(async (q) => {
    const [d] = await q<DraftRow>("SELECT * FROM email_drafts WHERE id = $1 AND user_id = $2 FOR UPDATE", [draftId, userId]);
    if (!d) return null;
    if (d.application_id) return d.application_id;
    if (!d.startup_id) return null;
    const [a] = await q<{ id: number }>(
      `INSERT INTO applications (user_id, startup_id, job_id, status) VALUES ($1, $2, $3, 'Saved')
       ON CONFLICT (COALESCE(user_id, 0), startup_id, COALESCE(job_id, 0)) DO UPDATE SET updated_at = now() RETURNING id`,
      [userId, d.startup_id, d.job_id]
    );
    await q("UPDATE email_drafts SET application_id = $3 WHERE id = $1 AND user_id = $2", [draftId, userId, a.id]);
    return a.id;
  });
}

/**
 * "I sent this myself" (LinkedIn, a Gmail compose window, a mail client). Recorded only on the user's explicit confirmation,
 * as via='manual': Jyntra did not send it and cannot know it was delivered. Idempotent: a second call changes nothing.
 */
export async function logManualSend(user: AppUser, id: number, p: { confirm: unknown }): Promise<ServiceResult> {
  if (p.confirm !== true) return { status: 400, body: { ok: false, error: "confirmation_required", message: "Confirm that you sent this message yourself." } };
  const d = await getDraft(user.id, id);
  if (!d) return { status: 404, body: { ok: false, error: "not_found" } };
  if (d.status === "sent") return { status: 200, body: { ok: true, duplicate: true, draft: publicDraft(d), message: "Already recorded. Nothing changed." } };
  if (d.status === "sending") return { status: 409, body: { ok: false, error: "in_progress", message: "This message is being sent right now." } };
  if (!d.body.trim()) return { status: 400, body: { ok: false, error: "body_required" } };
  const rows = await query(
    `UPDATE email_drafts SET status = 'sent', via = 'manual', from_email = NULL, provider_message_id = NULL, error_code = NULL, sent_at = now(), updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status IN ('draft','failed','unknown') RETURNING id`, [id, user.id]);
  if (!rows.length) return { status: 409, body: { ok: false, error: "in_progress" } };
  await linkApplication(user.id, id).catch((e) => console.error("[comms/manual] could not link:", (e as Error).name));
  return { status: 200, body: { ok: true, sent: false, logged_by_user: true, via: "manual", draft: publicDraft((await getDraft(user.id, id))!), message: "Recorded as sent by you. Jyntra did not send it and cannot confirm delivery." } };
}
