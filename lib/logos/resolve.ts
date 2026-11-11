// Resolve a company logo only from a verified official website. Never guessed from the company name or slug.
import fs from "node:fs";
import path from "node:path";
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/lib/net/public-url";
import { validateApplicationUrl } from "@/lib/company-jobs/urls";

export type LogoStatus = "resolved" | "initials" | "failed";
export interface LogoResult {
  status: LogoStatus;
  url: string | null;
  sourceDomain: string | null;
  bytes: Buffer | null;
  contentType: string | null;
}

const CACHE_DIR = path.join(process.cwd(), ".cache", "logos");
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const ICON_RE = /<link\b[^>]*rel=["']([^"']*)["'][^>]*href=["']([^"']+)["'][^>]*>|<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']([^"']*)["'][^>]*>/gi;

export interface SafeFetch {
  (url: string, init: { headers?: Record<string, string>; redirect?: "manual" | "follow"; signal?: AbortSignal }): Promise<{
    status: number;
    headers: { get(name: string): string | null };
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    url?: string;
  }>;
}

async function fetchHttps(url: string, fetchImpl: SafeFetch, hops = 0): Promise<{ status: number; headers: { get(n: string): string | null }; buf: Buffer; finalUrl: string }> {
  const dest = await assertPublicHttpsUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(dest.toString(), {
      headers: { Accept: "image/*,text/html;q=0.8", "User-Agent": "JyntraLogoResolver/1.0" },
      redirect: "manual",
      signal: ctrl.signal,
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc || hops >= MAX_REDIRECTS) throw new UnsafeUrlError("unsafe or excessive redirect");
      const next = new URL(loc, dest);
      if (next.protocol !== "https:") throw new UnsafeUrlError("redirect is not HTTPS");
      await assertPublicHttpsUrl(next.toString());
      return fetchHttps(next.toString(), fetchImpl, hops + 1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new UnsafeUrlError("response too large");
    return { status: res.status, headers: res.headers, buf, finalUrl: dest.toString() };
  } finally {
    clearTimeout(timer);
  }
}

function iconHrefs(html: string, base: string): string[] {
  const out: { href: string; score: number }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(ICON_RE.source, "gi");
  while ((m = re.exec(html))) {
    const rel = (m[1] || m[4] || "").toLowerCase();
    const href = m[2] || m[3];
    if (!href || !/icon|apple-touch-icon|shortcut/i.test(rel)) continue;
    try {
      const abs = new URL(href, base).toString();
      const score = /apple-touch/.test(rel) ? 3 : /icon/.test(rel) ? 2 : 1;
      out.push({ href: abs, score });
    } catch {
      /* skip */
    }
  }
  return [...new Set(out.sort((a, b) => b.score - a.score).map((x) => x.href))];
}

function isImageType(ct: string | null): boolean {
  const t = (ct ?? "").split(";")[0].trim().toLowerCase();
  return t.startsWith("image/") || t === "image/x-icon" || t === "image/vnd.microsoft.icon";
}

async function tryImage(url: string, fetchImpl: SafeFetch): Promise<{ bytes: Buffer; contentType: string; sourceDomain: string } | null> {
  const safe = validateApplicationUrl(url);
  if (!safe) return null;
  try {
    const r = await fetchHttps(safe, fetchImpl);
    if (r.status !== 200) return null;
    const ct = r.headers.get("content-type");
    if (!isImageType(ct) && !looksLikeImage(r.buf)) return null;
    return { bytes: r.buf, contentType: (ct ?? "image/png").split(";")[0].trim(), sourceDomain: new URL(r.finalUrl).hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50) return true; // png
  if (buf[0] === 0xff && buf[1] === 0xd8) return true; // jpeg
  if (buf[0] === 0x47 && buf[1] === 0x49) return true; // gif
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01) return true; // ico
  if (buf.slice(0, 4).toString() === "RIFF") return true; // webp
  if (buf.slice(0, 4).toString("ascii").includes("<sv") || buf.slice(0, 5).toString("ascii") === "<?xml") return true;
  return false;
}

/**
 * website must already be a trusted official company site (from stored records). This function never
 * derives a domain from the company name or slug.
 */
export async function resolveCompanyLogo(
  website: string | null | undefined,
  opts: { fetchImpl?: SafeFetch; providerTemplate?: string | null } = {}
): Promise<LogoResult> {
  const site = validateApplicationUrl(website ?? null);
  if (!site) return { status: "initials", url: null, sourceDomain: null, bytes: null, contentType: null };
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as SafeFetch);
  try {
    const page = await fetchHttps(site, fetchImpl);
    const html = page.status === 200 ? page.buf.toString("utf8") : "";
    const candidates = iconHrefs(html, site);
    candidates.push(new URL("/favicon.ico", site).toString());
    for (const href of candidates) {
      const img = await tryImage(href, fetchImpl);
      if (img) return { status: "resolved", url: href, sourceDomain: img.sourceDomain, bytes: img.bytes, contentType: img.contentType };
    }
    const tpl = opts.providerTemplate ?? process.env.COMPANY_LOGO_PROVIDER_URL ?? "";
    if (tpl && tpl.includes("{domain}")) {
      const domain = new URL(site).hostname.replace(/^www\./, "");
      const providerUrl = tpl.replace("{domain}", encodeURIComponent(domain));
      const img = await tryImage(providerUrl, fetchImpl);
      if (img) return { status: "resolved", url: providerUrl, sourceDomain: img.sourceDomain, bytes: img.bytes, contentType: img.contentType };
    }
    return { status: "initials", url: null, sourceDomain: null, bytes: null, contentType: null };
  } catch (e) {
    if (e instanceof UnsafeUrlError) return { status: "failed", url: null, sourceDomain: null, bytes: null, contentType: null };
    return { status: "failed", url: null, sourceDomain: null, bytes: null, contentType: null };
  }
}

export function logoCachePath(slug: string) {
  return path.join(CACHE_DIR, slug.replace(/[^a-z0-9-]/gi, "_"));
}

export function writeLogoCache(slug: string, contentType: string, bytes: Buffer) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(logoCachePath(slug) + ".meta", contentType);
  fs.writeFileSync(logoCachePath(slug), bytes);
}

export function readLogoCache(slug: string, maxAgeMs = 7 * 24 * 3600_000): { contentType: string; bytes: Buffer } | null {
  try {
    const p = logoCachePath(slug);
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs > maxAgeMs) return null;
    return { contentType: fs.readFileSync(p + ".meta", "utf8").trim(), bytes: fs.readFileSync(p) };
  } catch {
    return null;
  }
}
