// Gmail through Google's official OAuth + Gmail API (scope gmail.send only: the app can send, it cannot read the mailbox).
// Every network call takes an injectable fetch so tests never touch Google. Tokens and bodies are never logged.
import crypto from "node:crypto";
import { buildMime, toBase64Url } from "./mime";

export const GMAIL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send"];
export const STATE_COOKIE = "comms_gmail_state";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

type F = typeof fetch;
export const gmailOAuthConfigured = (env: Record<string, string | undefined> = process.env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const signState = (userId: number, nonce: string, env: Record<string, string | undefined> = process.env) =>
  crypto.createHmac("sha256", `${env.CREDENTIAL_ENCRYPTION_KEY || env.KB_ENCRYPTION_KEY || ""}|gmail-oauth-state`).update(`${userId}.${nonce}`).digest("base64url");

export function authorizeUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const p = new URLSearchParams({ client_id: o.clientId, redirect_uri: o.redirectUri, response_type: "code", scope: GMAIL_SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "false", state: o.state });
  return `${AUTH}?${p}`;
}

export type GmailErrorCode = "reconnect_required" | "rate_limited" | "provider_unavailable" | "invalid_message" | "no_response" | "not_configured" | "scope_missing";
/** `accepted` is false for every code except no_response, where the outcome is unknown. */
export class GmailError extends Error {
  constructor(public code: GmailErrorCode, public retryAfterMs?: number) { super(code); }
}

const post = async (f: F, url: string, init: RequestInit): Promise<Response> => {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new GmailError("no_response");
  }
};

export async function exchangeCode(o: { clientId: string; clientSecret: string; code: string; redirectUri: string; fetchImpl?: F }): Promise<{ refreshToken: string; accessToken: string; scope: string }> {
  const res = await post(o.fetchImpl ?? fetch, TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: o.code, client_id: o.clientId, client_secret: o.clientSecret, redirect_uri: o.redirectUri, grant_type: "authorization_code" }) });
  const d = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string; scope?: string } | null;
  if (!res.ok || !d?.access_token) throw new GmailError("reconnect_required");
  if (!d.refresh_token) throw new GmailError("reconnect_required"); // Google only returns one on first consent: we asked for prompt=consent, so absence means something is off
  if (!(d.scope ?? "").includes("gmail.send")) throw new GmailError("scope_missing");
  return { refreshToken: d.refresh_token, accessToken: d.access_token, scope: d.scope! };
}

export async function accountEmail(accessToken: string, fetchImpl: F = fetch): Promise<string> {
  const res = await post(fetchImpl, USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
  const d = (await res.json().catch(() => null)) as { email?: string } | null;
  if (!res.ok || !d?.email) throw new GmailError("reconnect_required");
  return d.email;
}

export async function refreshAccessToken(o: { clientId: string; clientSecret: string; refreshToken: string; fetchImpl?: F }): Promise<string> {
  const res = await post(o.fetchImpl ?? fetch, TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, refresh_token: o.refreshToken, grant_type: "refresh_token" }) });
  const d = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (res.ok && d?.access_token) return d.access_token;
  // invalid_grant = the user revoked access or the token expired: the account must be reconnected.
  if (res.status === 400 || res.status === 401) throw new GmailError("reconnect_required");
  throw new GmailError(res.status === 429 ? "rate_limited" : "provider_unavailable");
}

/** Revokes a token at Google. Returns whether Google confirmed it; the caller removes the local copy either way. */
export async function revokeToken(token: string, fetchImpl: F = fetch): Promise<boolean> {
  try {
    const res = await post(fetchImpl, REVOKE, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
    return res.ok;
  } catch { return false; }
}

export interface GmailSendInput { accessToken: string; from: string; fromName?: string; to: string; cc?: string[]; subject: string; text: string; fetchImpl?: F }
/**
 * Sends one message. Resolves ONLY when Gmail returned a message id (its confirmation).
 * Throws GmailError: every code except "no_response" means Gmail answered and did not accept the message.
 */
export async function sendGmail(i: GmailSendInput): Promise<{ id: string; threadId: string | null }> {
  let raw: string;
  try { raw = toBase64Url(buildMime({ from: i.from, fromName: i.fromName, to: i.to, cc: i.cc, subject: i.subject, text: i.text })); } catch { throw new GmailError("invalid_message"); }
  const res = await post(i.fetchImpl ?? fetch, SEND, { method: "POST", headers: { Authorization: `Bearer ${i.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
  if (res.ok) {
    const d = (await res.json().catch(() => null)) as { id?: string; threadId?: string } | null;
    if (d?.id) return { id: d.id, threadId: d.threadId ?? null };
    throw new GmailError("no_response"); // 2xx without an id: we can't claim it was sent, and we can't be sure it wasn't
  }
  const retry = Number(res.headers.get("retry-after"));
  if (res.status === 401) throw new GmailError("reconnect_required");
  if (res.status === 429 || res.status === 403) throw new GmailError(res.status === 403 && !/rate|quota|limit/i.test(await res.text().catch(() => "")) ? "reconnect_required" : "rate_limited", Number.isFinite(retry) ? retry * 1000 : undefined);
  if (res.status >= 500) throw new GmailError("provider_unavailable", Number.isFinite(retry) ? retry * 1000 : undefined);
  throw new GmailError("invalid_message");
}
