// Builds the RFC 2822 message the Gmail API sends. Headers are data, never syntax: any line break in a header value is refused.
import crypto from "node:crypto";

export interface MimeInput { from: string; fromName?: string; to: string; cc?: string[]; subject: string; text: string; date?: Date }

const noBreaks = (s: string) => !/[\r\n\u2028\u2029\u0000]/.test(s);
const safeName = (n?: string) => (n ?? "").replace(/[\u0000-\u001F\u007F"<>\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);
/** RFC 2047 encoded-word for non-ASCII header text. */
export const encodeWord = (s: string) => (ascii(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

export function buildMime(m: MimeInput): string {
  for (const v of [m.from, m.to, m.subject, ...(m.cc ?? [])]) if (!noBreaks(v)) throw new Error("header_injection");
  const name = safeName(m.fromName);
  const from = name ? `${encodeWord(name)} <${m.from}>` : m.from;
  const domain = m.from.split("@")[1] ?? "jyntra.local";
  const body = Buffer.from(m.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${from}`,
    `To: ${m.to}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.join(", ")}`] : []),
    `Subject: ${encodeWord(m.subject)}`,
    `Date: ${(m.date ?? new Date()).toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

export const toBase64Url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
