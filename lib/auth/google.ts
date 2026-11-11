// "Sign in with Google" (OpenID Connect, authorization-code flow with PKCE, state and nonce). Pure helpers: no database, injectable fetch.
// Login asks for identity only (openid email profile). It never gets Gmail access; the separate "Connect Gmail" flow asks for gmail.send.
import crypto from "node:crypto";

export const LOGIN_COOKIE = "jy_login";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
type Env = Record<string, string | undefined>;
type F = typeof fetch;

const secret = (env: Env) => env.CREDENTIAL_ENCRYPTION_KEY || env.KB_ENCRYPTION_KEY || "";
export const googleLoginConfigured = (env: Env = process.env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && secret(env).length >= 16);
export const redirectUri = (origin: string, env: Env = process.env) => `${(env.APP_URL || origin).replace(/\/$/, "")}/api/auth/google/callback`;

const b64 = (b: Buffer) => b.toString("base64url");
const sign = (payload: string, env: Env) => b64(crypto.createHmac("sha256", `${secret(env)}|google-login`).update(payload).digest());

/** Only same-site relative paths survive; anything else (absolute URLs, //host, backslashes) becomes the default. Stops open redirects. */
export function safeNext(v: unknown, fallback = "/career-ai"): string {
  if (typeof v !== "string" || v.length > 200 || !v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f]/.test(v)) return fallback;
  return v;
}

export interface LoginTicket { state: string; verifier: string; nonce: string; next: string }
export function newTicket(next: unknown): LoginTicket {
  return { state: b64(crypto.randomBytes(18)), verifier: b64(crypto.randomBytes(32)), nonce: b64(crypto.randomBytes(18)), next: safeNext(next) };
}
/** The ticket lives in a short-lived httpOnly cookie, HMAC-signed so it cannot be forged or edited. */
export function packTicket(t: LoginTicket, env: Env = process.env): string {
  const p = b64(Buffer.from(JSON.stringify(t)));
  return `${p}.${sign(p, env)}`;
}
export function unpackTicket(cookie: string | undefined, env: Env = process.env): LoginTicket | null {
  const [p, sig] = (cookie ?? "").split(".");
  if (!p || !sig) return null;
  const want = sign(p, env);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const t = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    return t && typeof t.state === "string" && typeof t.verifier === "string" && typeof t.nonce === "string" ? { ...t, next: safeNext(t.next) } : null;
  } catch { return null; }
}

export function authorizeUrl(o: { clientId: string; redirectUri: string; ticket: LoginTicket }): string {
  const challenge = b64(crypto.createHash("sha256").update(o.ticket.verifier).digest());
  const p = new URLSearchParams({ client_id: o.clientId, redirect_uri: o.redirectUri, response_type: "code", scope: "openid email profile", state: o.ticket.state, nonce: o.ticket.nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" });
  return `${AUTH}?${p}`;
}

export interface GoogleIdentity { sub: string; email: string; name: string }
export class LoginError extends Error { constructor(public code: "exchange_failed" | "bad_token" | "unverified_email") { super(code); } }

/** Checks the claims of an ID token that came straight from Google's token endpoint over TLS (iss, aud, exp, nonce, verified email). */
export function identityFromClaims(c: Record<string, any>, o: { clientId: string; nonce: string; now?: number }): GoogleIdentity {
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") throw new LoginError("bad_token");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(o.clientId) || typeof c.exp !== "number" || c.exp < now - 60 || c.nonce !== o.nonce || typeof c.sub !== "string" || !c.sub) throw new LoginError("bad_token");
  if (c.email_verified !== true || typeof c.email !== "string" || !c.email.includes("@")) throw new LoginError("unverified_email");
  return { sub: c.sub.slice(0, 64), email: c.email.toLowerCase().slice(0, 254), name: typeof c.name === "string" ? c.name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80) : "" };
}

export async function exchangeLoginCode(o: { clientId: string; clientSecret: string; code: string; redirectUri: string; ticket: LoginTicket; fetchImpl?: F }): Promise<GoogleIdentity> {
  let r: Response;
  try {
    r = await (o.fetchImpl ?? fetch)(TOKEN, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ code: o.code, client_id: o.clientId, client_secret: o.clientSecret, redirect_uri: o.redirectUri, grant_type: "authorization_code", code_verifier: o.ticket.verifier }),
    });
  } catch { throw new LoginError("exchange_failed"); }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || typeof j.id_token !== "string") throw new LoginError("exchange_failed");
  const part = j.id_token.split(".")[1];
  let claims: Record<string, any>;
  try { claims = JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8")); } catch { throw new LoginError("bad_token"); }
  return identityFromClaims(claims, { clientId: o.clientId, nonce: o.ticket.nonce });
}
