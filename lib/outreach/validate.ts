// Input validation for outreach send / draft requests. Pure, so it is tested without a server.
export const CHANNELS = ["email", "linkedin_dm", "twitter_dm", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface OutreachInput {
  startup_id: number;
  job_id: number | null;
  channel: Channel;
  /** 'smtp' = the app sends via Gmail. 'manual' = the user says they sent it themselves. */
  delivery: "smtp" | "manual";
  recipient_email: string | null;
  recipient_name: string | null;
  subject: string | null;
  body: string;
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 2_147_483_647;
const hasLineBreak = (s: string) => /[\r\n\u2028\u2029]/.test(s);
// Deliberately simple: one @, no spaces or control characters, a dotted domain. Real validation is the SMTP server's job.
export const isValidEmail = (e: string) => e.length <= 254 && /^[^\s@<>(),;:\\"\u0000-\u001F]+@[^\s@<>(),;:\\"\u0000-\u001F]+\.[^\s@<>(),;:\\"\u0000-\u001F]{2,}$/.test(e);

export type Validated = { ok: true; value: OutreachInput } | { ok: false; error: string };

/** `mode` 'send' needs a body and (for SMTP) a recipient. 'draft' only needs a body. */
export function validateOutreach(raw: unknown, mode: "send" | "draft"): Validated {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "invalid_request" };
  const b = raw as Record<string, unknown>;
  if (!isId(b.startup_id)) return { ok: false, error: "invalid_startup_id" };
  if (b.job_id !== undefined && b.job_id !== null && !isId(b.job_id)) return { ok: false, error: "invalid_job_id" };
  const channel = (b.channel ?? "email") as string;
  if (!(CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: "invalid_channel" };

  let delivery: "smtp" | "manual" = channel === "email" ? "smtp" : "manual";
  if (b.delivery !== undefined) {
    if (b.delivery !== "smtp" && b.delivery !== "manual") return { ok: false, error: "invalid_delivery" };
    delivery = b.delivery;
  }
  if (delivery === "smtp" && channel !== "email") return { ok: false, error: "only_email_can_be_sent_by_the_app" };

  const str = (v: unknown, max: number, name: string): string | null | { err: string } => {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string") return { err: `invalid_${name}` };
    const t = v.trim();
    if (t.length > max) return { err: `${name}_too_long` };
    return t || null;
  };
  const email = str(b.recipient_email, 254, "recipient_email");
  const name = str(b.recipient_name, 80, "recipient_name");
  const subject = str(b.subject, 200, "subject");
  for (const x of [email, name, subject]) if (x && typeof x === "object") return { ok: false, error: x.err };
  const recipient_email = email as string | null;
  const recipient_name = name as string | null;
  const subj = subject as string | null;
  if (recipient_email && (!isValidEmail(recipient_email) || hasLineBreak(recipient_email))) return { ok: false, error: "invalid_recipient_email" };
  if (recipient_name && hasLineBreak(recipient_name)) return { ok: false, error: "invalid_recipient_name" };
  if (subj && hasLineBreak(subj)) return { ok: false, error: "invalid_subject" };

  if (typeof b.body !== "string" || !b.body.trim()) return { ok: false, error: "body_required" };
  if (b.body.length > 10_000) return { ok: false, error: "body_too_long" };
  if (mode === "send" && delivery === "smtp" && !recipient_email) return { ok: false, error: "recipient_email_required" };

  return {
    ok: true,
    value: { startup_id: b.startup_id, job_id: (b.job_id as number | null | undefined) ?? null, channel: channel as Channel, delivery, recipient_email, recipient_name, subject: subj, body: b.body.trim() },
  };
}
