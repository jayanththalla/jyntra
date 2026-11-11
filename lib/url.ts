// URL canonicalisation for de-duplication. The ORIGINAL url is what users click; this form is only for comparing.
const TRACKING = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|ref|ref_src|source|src|gh_src|lever-source|lever-origin|trk|trkinfo)$/i;

export function canonicalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    let s = u.toString();
    if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
    return s;
  } catch {
    return null;
  }
}

/**
 * Returns the URL only if it is a plain http(s) link with a host; otherwise null. Use for EVERY link that comes from
 * outside (sources, scraped pages, user profile fields) before it is stored or put in an href. This blocks
 * `javascript:`, `data:`, `vbscript:`, `file:` and malformed values. With `assumeHttps`, "github.com/me" becomes
 * "https://github.com/me" (for fields a person types by hand).
 */
export function safeHttpUrl(raw: string | null | undefined, opts: { assumeHttps?: boolean } = {}): string | null {
  let s = (raw ?? "").trim();
  if (!s || s.length > 2000 || /[\u0000-\u001F\u007F\s]/.test(s)) return null;
  if (opts.assumeHttps && !/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[^/?#:]+\.[^/?#:]+/.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || u.username || u.password) return null; // no embedded credentials either
    return u.toString();
  } catch {
    return null;
  }
}
