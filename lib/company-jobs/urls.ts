// Application-link validation. A missing or unsafe value stays null — never replaced with a company page or invented path.
import { canonicalUrl, safeHttpUrl } from "@/lib/url";

const UNSAFE_SCHEME = /^(javascript|data|vbscript|file|blob|about):/i;

/**
 * Direct application destination: HTTPS only, no credentials, no javascript URLs.
 * HTTP is upgraded only when the rest of the URL is already a well-formed host path (then stored as https).
 */
export function validateApplicationUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || s.length > 2000) return null;
  if (UNSAFE_SCHEME.test(s)) return null;
  const https = safeHttpUrl(s, { assumeHttps: false });
  if (!https) return null;
  try {
    const u = new URL(https);
    if (u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    if (!u.hostname || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** True when `candidate` is just the company's listing page, not a real apply destination. */
export function isCompanyPageUrl(candidate: string | null | undefined, companyPage: string | null | undefined, slug?: string): boolean {
  const a = canonicalUrl(candidate);
  const b = canonicalUrl(companyPage);
  if (!a) return false;
  if (b && a === b) return true;
  if (slug && /^https:\/\/(www\.)?blrstartuparena\.com\/companies\/[^/?#]+$/i.test(a) && a.endsWith(`/companies/${slug}`)) return true;
  return false;
}

export function applicationUrlOrNull(raw: string | null | undefined, companyPage?: string | null, slug?: string): string | null {
  const u = validateApplicationUrl(raw);
  if (!u) return null;
  if (isCompanyPageUrl(u, companyPage ?? null, slug)) return null;
  return u;
}

export function canonicalApplicationUrl(raw: string | null | undefined): string | null {
  return canonicalUrl(validateApplicationUrl(raw));
}
