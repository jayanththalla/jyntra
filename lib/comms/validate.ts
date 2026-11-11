// Input validation for email drafts. Pure.
import { isValidEmail } from "@/lib/outreach/validate";

export const EMAIL_KINDS = ["cold_founder", "cold_recruiter", "job_application", "cover_letter", "recruiter_reply", "interview_scheduling", "thank_you", "follow_up", "linkedin_dm", "cold_email"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export const MAX_CC = 5;
const hasBreak = (s: string) => /[\r\n\u2028\u2029]/.test(s);

export function normalizeEmail(s: string): string { return s.trim().toLowerCase(); }

/** Parses "a@x.com, b@y.com" or an array. Returns the valid, de-duplicated addresses or the first problem. */
export function parseRecipients(raw: unknown, max = MAX_CC): { ok: true; list: string[] } | { ok: false; error: string } {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;\s]+/) : raw == null ? [] : null;
  if (!parts) return { ok: false, error: "invalid_cc" };
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p !== "string") return { ok: false, error: "invalid_cc" };
    const e = p.trim();
    if (!e) continue;
    if (hasBreak(e) || !isValidEmail(e)) return { ok: false, error: "invalid_cc" };
    if (!out.includes(normalizeEmail(e))) out.push(normalizeEmail(e));
  }
  if (out.length > max) return { ok: false, error: "too_many_cc" };
  return { ok: true, list: out };
}

export interface DraftInput {
  kind: EmailKind;
  to_email: string | null;
  recipient_name: string | null;
  cc: string[];
  subject: string;
  body: string;
  application_id: number | null;
  startup_id: number | null;
  job_id: number | null;
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 2_147_483_647;

/** `send` mode demands a valid recipient, subject and body; `save` only needs something to keep. */
export function validateDraft(raw: unknown, mode: "save" | "send", base?: Partial<DraftInput>): { ok: true; value: DraftInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "invalid_request" };
  const b = raw as Record<string, unknown>;
  const pick = <T,>(k: string, fallback: T): unknown => (k in b ? b[k] : fallback);
  const kind = pick("kind", base?.kind ?? "cold_email");
  if (typeof kind !== "string" || !(EMAIL_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "invalid_kind" };
  const text = (k: string, max: number, fb: string | null | undefined, name: string): string | null | { err: string } => {
    const v = pick(k, fb ?? null);
    if (v === null || v === undefined || v === "") return null;
    if (typeof v !== "string") return { err: `invalid_${name}` };
    if (v.length > max) return { err: `${name}_too_long` };
    return v.trim() || null;
  };
  const to = text("to_email", 254, base?.to_email, "to_email");
  const name = text("recipient_name", 80, base?.recipient_name, "recipient_name");
  const subject = text("subject", 200, base?.subject, "subject");
  const body = text("body", 10_000, base?.body, "body");
  for (const x of [to, name, subject, body]) if (x && typeof x === "object") return { ok: false, error: x.err };
  if (to && (hasBreak(to as string) || !isValidEmail(to as string))) return { ok: false, error: "invalid_to_email" };
  if (name && hasBreak(name as string)) return { ok: false, error: "invalid_recipient_name" };
  if (subject && hasBreak(subject as string)) return { ok: false, error: "invalid_subject" };
  const cc = parseRecipients(pick("cc", base?.cc ?? []));
  if (!cc.ok) return cc;
  for (const k of ["application_id", "startup_id", "job_id"] as const) {
    const v = pick(k, base?.[k] ?? null);
    if (v !== null && v !== undefined && !isId(v)) return { ok: false, error: `invalid_${k}` };
  }
  if (mode === "send") {
    if (kind === "linkedin_dm") return { ok: false, error: "linkedin_cannot_be_sent_here" };
    if (!to) return { ok: false, error: "recipient_required" };
    if (!subject) return { ok: false, error: "subject_required" };
    if (!body) return { ok: false, error: "body_required" };
    if (cc.list.includes(normalizeEmail(to as string))) return { ok: false, error: "cc_repeats_recipient" };
  }
  return { ok: true, value: { kind: kind as EmailKind, to_email: to ? normalizeEmail(to as string) : null, recipient_name: name as string | null, cc: cc.list, subject: (subject as string | null) ?? "", body: (body as string | null) ?? "", application_id: (pick("application_id", base?.application_id ?? null) as number | null) ?? null, startup_id: (pick("startup_id", base?.startup_id ?? null) as number | null) ?? null, job_id: (pick("job_id", base?.job_id ?? null) as number | null) ?? null } };
}
