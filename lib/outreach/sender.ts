import nodemailer from "nodemailer";

export interface SendEmailOptions {
  to: string;
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
  credentials?: {
    user?: string;
    pass?: string;
  };
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  from?: string;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A display name is data, not syntax: drop quotes, angle brackets and control characters so it can't alter headers. */
const safeName = (n?: string) => (n ?? "").replace(/[\u0000-\u001F\u007F"<>\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export interface SenderDeps {
  createTransport?: (opts: any) => { sendMail: (m: any) => Promise<any> };
}

/** Maps transport errors to messages that are safe to show (no server text, hostnames or credentials). */
export function describeSendError(e: any): string {
  const code = String(e?.code ?? "");
  const msg = String(e?.message ?? "");
  if (code === "EAUTH" || /Invalid login|Username and Password not accepted|BadCredentials/i.test(msg))
    return "Gmail rejected the login. Use your Gmail address and a 16-character Google App Password (not your normal password).";
  if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION" || code === "ECONNREFUSED" || code === "EDNS" || /timeout/i.test(msg))
    return "Couldn't reach Gmail. Check your connection and try again. Nothing was sent.";
  if (code === "EENVELOPE") return "Gmail refused the recipient address. Nothing was sent.";
  return "Gmail could not send this message. Nothing was sent.";
}

/**
 * Sends an email from the user's own Gmail account over SMTP. `ok: true` means Gmail ACCEPTED the message for
 * delivery (we do not claim it was read or even delivered to the recipient's inbox).
 */
export async function sendPersonalGmail(options: SendEmailOptions, deps: SenderDeps = {}): Promise<SendResult> {
  // Only the caller's own credentials are ever used. There is deliberately no server-wide mailbox fallback:
  // it would let any signed-in user send mail as the operator.
  const user = options.credentials?.user?.trim();
  const pass = options.credentials?.pass?.replace(/\s+/g, "");

  if (!user || !pass) {
    return { ok: false, error: "Gmail isn't set up yet. Add your Gmail address and 16-character App Password first." };
  }
  if (/[\r\n]/.test(options.to) || /[\r\n]/.test(options.subject) || (options.cc ?? []).some((c) => /[\r\n]/.test(c))) return { ok: false, error: "Invalid recipient or subject." };

  try {
    const transporter = (deps.createTransport ?? (nodemailer.createTransport as unknown as NonNullable<SenderDeps["createTransport"]>))({
      service: "gmail",
      auth: { user, pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    const name = safeName(options.fromName);
    const info = await transporter.sendMail({
      from: name ? { name, address: user } : user,
      to: options.to,
      ...(options.cc?.length ? { cc: options.cc } : {}),
      subject: options.subject,
      text: options.text,
      html: options.html || esc(options.text).replace(/\r?\n/g, "<br>"), // escaped: the body is text, never markup
    });
    const accepted: string[] = Array.isArray(info?.accepted) ? info.accepted : [];
    if (Array.isArray(info?.accepted) && accepted.length === 0) return { ok: false, error: "Gmail refused the recipient address. Nothing was sent." };
    return { ok: true, messageId: info?.messageId, from: user };
  } catch (err: any) {
    console.error("[outreach/send] SMTP failure:", err?.code ?? err?.name); // code only: never the message (may echo the login)
    return { ok: false, error: describeSendError(err) };
  }
}
