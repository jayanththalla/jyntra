// Gmail app-password lifecycle. The profile JSON only ever holds `gmail_app_password_enc` (ciphertext).
// A legacy plaintext `gmail_app_password` is never used for sending and is dropped on the next save.
import type { CandidateProfile } from "@/lib/types";
import { open, seal, VaultDecryptError, VaultNotConfigured } from "./vault";

/** Google app passwords are 16 letters, usually shown in groups of four. */
export function normalizeAppPassword(raw: string): string | null {
  const p = raw.replace(/\s+/g, "");
  return /^[A-Za-z0-9]{16}$/.test(p) ? p : null;
}

/** Profile after a settings save. `incoming`: undefined/blank = keep, string = replace. Gmail address cleared = clear both. */
export function applyGmailPassword(
  base: CandidateProfile,
  userId: number | null,
  incoming: unknown,
  gmailUser: string | undefined,
  env: Record<string, string | undefined> = process.env
): { enc?: string; error?: "invalid_password" | "not_configured" | "needs_account" } {
  if (typeof gmailUser === "string" && !gmailUser.trim()) return { enc: undefined }; // address cleared → credential cleared
  if (typeof incoming !== "string" || !incoming.trim()) return { enc: base.gmail_app_password_enc as string | undefined };
  const pass = normalizeAppPassword(incoming);
  if (!pass) return { error: "invalid_password" };
  if (userId === null) return { error: "needs_account" };
  try {
    return { enc: seal(pass, "gmail-smtp", userId, env) };
  } catch (e) {
    if (e instanceof VaultNotConfigured) return { error: "not_configured" };
    throw e;
  }
}

export type Resolved = { ok: true; pass: string } | { ok: false; reason: "not_set" | "reenter" | "not_configured" };

/** Server-only: decrypts for the instant of use. */
export function resolveGmailPassword(userId: number, profile: CandidateProfile, env: Record<string, string | undefined> = process.env): Resolved {
  const enc = profile.gmail_app_password_enc;
  if (typeof enc === "string" && enc) {
    try {
      return { ok: true, pass: open(enc, "gmail-smtp", userId, env) };
    } catch (e) {
      if (e instanceof VaultNotConfigured) return { ok: false, reason: "not_configured" };
      if (e instanceof VaultDecryptError) return { ok: false, reason: "reenter" };
      throw e;
    }
  }
  return { ok: false, reason: profile.gmail_app_password ? "reenter" : "not_set" }; // legacy plaintext is never used
}

export const gmailPasswordState = (p: CandidateProfile) => ({
  gmail_app_password_set: typeof p.gmail_app_password_enc === "string" && !!p.gmail_app_password_enc,
  gmail_app_password_reenter: !p.gmail_app_password_enc && !!p.gmail_app_password,
});

/** The profile as the browser may see it: no secrets, no ciphertext. */
export function publicProfile(p: CandidateProfile): CandidateProfile {
  const { gmail_app_password: _a, gmail_app_password_enc: _b, ...rest } = p;
  return { ...rest, ...gmailPasswordState(p) } as CandidateProfile;
}
