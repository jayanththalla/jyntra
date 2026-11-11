// Text extraction for uploaded documents. Pure parsing: nothing in a file is ever executed.
import { redactSecrets } from "./safety";
import { assertSafeZip, ZipTooLarge } from "./zipguard";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 400_000;

export interface ExtractOk {
  text: string;
  docType: "resume" | "doc" | "note";
  warnings: string[];
}
export interface ExtractErr {
  error: "unsupported" | "too_large" | "empty" | "unreadable";
  message: string;
}

const TEXT_EXT = /\.(txt|md|mdx|rst|json|csv|tsv|log)$/i;

const clean = (s: string) => s.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();

export function looksLikeResume(name: string, text: string): boolean {
  if (/(^|[^a-z])(resume|résumé|cv)([^a-z]|$)/i.test(name)) return true;
  return /^\s*#*\s*education\b/im.test(text) && /^\s*#*\s*(work\s+)?experience\b/im.test(text);
}

function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i++) if (buf[i] === 0 || (buf[i] < 8 && buf[i] !== 0)) bad++;
  return bad / Math.max(1, n) > 0.02;
}

async function pdfText(bytes: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  if (pdf.numPages > 100) throw new Error("too many pages");
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((p, i) => `[page ${i + 1}]\n${p}`).join("\n\n");
}

async function docxText(bytes: Buffer): Promise<string> {
  // Zip-bomb guard: the archive is actually inflated under a hard cap (declared sizes are not trusted). See zipguard.ts.
  assertSafeZip(bytes);
  const mammoth = await import("mammoth");
  const r = await mammoth.extractRawText({ buffer: bytes });
  return r.value;
}

export async function extractText(file: { name: string; mime?: string; bytes: Buffer }): Promise<ExtractOk | ExtractErr> {
  const name = file.name.slice(0, 200);
  if (file.bytes.length > MAX_UPLOAD_BYTES) return { error: "too_large", message: "Files can be at most 5 MB." };
  if (file.bytes.length === 0) return { error: "empty", message: "The file is empty." };
  const warnings: string[] = [];
  let raw: string;
  try {
    if (/\.pdf$/i.test(name) || file.mime === "application/pdf") {
      if (file.bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: "unreadable", message: "This doesn't look like a valid PDF." };
      raw = await pdfText(file.bytes);
    } else if (/\.docx$/i.test(name)) {
      if (file.bytes[0] !== 0x50 || file.bytes[1] !== 0x4b) return { error: "unreadable", message: "This doesn't look like a valid DOCX." };
      raw = await docxText(file.bytes);
    } else if (TEXT_EXT.test(name) || (file.mime ?? "").startsWith("text/")) {
      if (isBinary(file.bytes)) return { error: "unsupported", message: "This file looks binary, not text." };
      raw = file.bytes.toString("utf8");
    } else {
      return { error: "unsupported", message: "Supported types: PDF, DOCX, TXT, MD, RST, JSON, CSV." };
    }
  } catch (e) {
    if (e instanceof ZipTooLarge) return { error: "too_large", message: "This document expands to far more than 40 MB once unpacked, so it was refused." };
    return { error: "unreadable", message: "We couldn't read this file. It may be corrupted or password-protected." };
  }
  let text = clean(raw);
  if (!text) return { error: "empty", message: "No text could be extracted (a scanned PDF needs OCR first)." };
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    warnings.push("Very long document: only the first 400,000 characters were kept.");
  }
  const red = redactSecrets(text);
  if (red.redactions) warnings.push(`${red.redactions} secret-like value(s) were redacted before indexing.`);
  const docType = looksLikeResume(name, red.text) ? "resume" : /\.(md|txt)$/i.test(name) && /(^|[^a-z])(notes?|prep)([^a-z]|$)/i.test(name) ? "note" : "doc";
  return { text: red.text, docType, warnings };
}
