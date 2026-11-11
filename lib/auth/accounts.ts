// Maps a verified Google identity to a Jyntra user. Never merges accounts by email alone.
import { query } from "@/lib/database";
import { GENERIC_PROFILE } from "@/lib/database";
import type { AppUser } from "@/lib/users";
import type { GoogleIdentity } from "./google";

/**
 *  1. Google account already linked to a user  -> that user.
 *  2. Someone is already using the app on this browser without a Google link -> link Google to THEM, so nothing they saved is lost.
 *  3. Otherwise -> a new user (explorer profile, so onboarding asks for skills).
 */
export async function userForGoogle(id: GoogleIdentity, current: AppUser | null): Promise<{ userId: number; created: boolean; linked: boolean }> {
  const find = async () => (await query<{ id: number }>("SELECT id FROM users WHERE google_sub = $1", [id.sub]))[0];
  const hit = await find();
  if (hit) { await query("UPDATE users SET email = $2 WHERE id = $1", [hit.id, id.email]); return { userId: hit.id, created: false, linked: false }; }
  if (current) {
    const [row] = await query<{ google_sub: string | null }>("SELECT google_sub FROM users WHERE id = $1", [current.id]);
    if (row && !row.google_sub) {
      try { await query("UPDATE users SET google_sub = $2, email = $3, updated_at = now() WHERE id = $1 AND google_sub IS NULL", [current.id, id.sub, id.email]); return { userId: current.id, created: false, linked: true }; }
      catch { const again = await find(); if (again) return { userId: again.id, created: false, linked: false }; throw new Error("link_failed"); }
    }
  }
  const profile = { ...GENERIC_PROFILE, explorer: true, ...(id.name ? { name: id.name } : {}) };
  try {
    const [u] = await query<{ id: number }>("INSERT INTO users (profile, google_sub, email) VALUES ($1,$2,$3) RETURNING id", [JSON.stringify(profile), id.sub, id.email]);
    return { userId: u.id, created: true, linked: false };
  } catch { const again = await find(); if (again) return { userId: again.id, created: false, linked: false }; throw new Error("create_failed"); }
}
