// Visitor identity without passwords or emails.
// - Each signed-in browser has a session: a random token in an httpOnly cookie. The database
//   stores only its SHA-256 hash.
// - The private link carries a separate random token (also stored as a hash). Opening it starts a
//   new session on that device. Asking for a new link replaces the old one, which stops working.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { query } from "@/lib/database";
import type { CandidateProfile } from "@/lib/types";

export const USER_COOKIE = "sf_uid";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export interface AppUser {
  id: number;
  profile: CandidateProfile;
  pinned: number[];
  /** When the current private link was created; null if the user never made one. */
  link_created_at: string | null;
  /** When the profile was created (optional: absent on a just-inserted row). */
  created_at?: string | Date;
  /** Verified Google email when signed in with Google, else null. */
  email: string | null;
  google_linked: boolean;
}

/** 192 random bits, URL-safe. */
const newToken = () => crypto.randomBytes(24).toString("base64url");

/** What the database stores instead of a token. Matches Postgres encode(sha256(convert_to(t,'UTF8')),'hex'). */
export const hashToken = (token: string) => crypto.createHash("sha256").update(token, "utf8").digest("hex");

const looksLikeToken = (t: string | null | undefined): t is string => !!t && t.length >= 20 && t.length <= 200;

const USER_COLS = "u.id, u.profile, u.pinned, u.link_created_at, u.created_at, u.email, (u.google_sub IS NOT NULL) AS google_linked";

/** User for a session cookie value, or null. */
export async function userBySession(token: string | null | undefined): Promise<AppUser | null> {
  if (!looksLikeToken(token)) return null;
  const rows = await query<AppUser & { session_id: number }>(
    `SELECT ${USER_COLS}, s.id AS session_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [hashToken(token)]
  );
  const row = rows[0];
  if (!row) return null;
  // Cheap "last seen" bumps, at most once an hour.
  query("UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 hour'", [row.session_id]).catch(() => {});
  query("UPDATE users SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 hour'", [row.id]).catch(() => {});
  const { session_id: _, ...user } = row;
  return user;
}

/** The session token from this request's cookie (route handlers and server components). */
export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(USER_COOKIE)?.value;
}

/** Current user from the request cookie. */
export async function currentUser(): Promise<AppUser | null> {
  return userBySession(await sessionToken());
}

/** Starts a session for a user; returns the token to put in the cookie. */
export async function createSession(userId: number): Promise<string> {
  const token = newToken();
  await query("INSERT INTO sessions (user_id, token_hash) VALUES ($1, $2)", [userId, hashToken(token)]);
  return token;
}

/** Ends one session (sign out on this device). */
export async function endSession(token: string | null | undefined): Promise<void> {
  if (looksLikeToken(token)) await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

/** New user plus a session for the browser that created it. */
export async function createUser(profile: CandidateProfile): Promise<{ user: AppUser; sessionToken: string }> {
  const rows = await query<AppUser>("INSERT INTO users (profile) VALUES ($1) RETURNING id, profile, pinned, link_created_at, email, (google_sub IS NOT NULL) AS google_linked", [JSON.stringify(profile)]);
  return { user: rows[0], sessionToken: await createSession(rows[0].id) };
}

/** User whose current private link carries this token, or null. */
export async function userByLinkToken(token: string | null | undefined): Promise<AppUser | null> {
  if (!looksLikeToken(token)) return null;
  const rows = await query<AppUser>(`SELECT ${USER_COLS} FROM users u WHERE u.link_token_hash = $1`, [hashToken(token)]);
  return rows[0] ?? null;
}

/** Makes a new private link token for the user. Any previous link stops working. Shown once: only the hash is kept. */
export async function newLinkToken(userId: number): Promise<string> {
  const token = newToken();
  await query("UPDATE users SET link_token_hash = $2, link_created_at = now() WHERE id = $1", [userId, hashToken(token)]);
  return token;
}

export async function updateUserProfile(userId: number, profile: CandidateProfile): Promise<void> {
  await query("UPDATE users SET profile = $2, updated_at = now() WHERE id = $1", [userId, JSON.stringify(profile)]);
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: COOKIE_MAX_AGE,
};
