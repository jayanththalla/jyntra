// Which company links may be shown next to a funding story, and with what label. Nothing is guessed:
//  - website: the company record's website. "verified" when the record came from a trusted company directory (YC, the Hyderabad
//    dataset, the company's own careers crawl); "unverified" when the only evidence is a link inside a news article.
//  - careers: the company record's careers URL, only when it is on the company's own domain or a known job-board host, and the
//    record's origin is a company page or dataset. Otherwise omitted.
//  - LinkedIn: only a /company/<slug> URL that is ALREADY on the company record from a trusted source. A slug is never built from
//    the company name and a search result is never used.
import { safeHttpUrl } from "@/lib/url";

export type LinkStatus = "verified" | "unverified";
export interface CompanyLink { url: string; status: LinkStatus; basis: string }
export interface CompanyLinks { website?: CompanyLink; careers?: CompanyLink; linkedin?: CompanyLink }

export interface CompanyRecord {
  website: string | null;
  careers_url: string | null;
  linkedin_url: string | null;
  source: string;
  sources_seen: string[] | null;
}

/** Sources that read the company's own page or a curated directory. A news feed is not one of them. */
const TRUSTED_ORIGINS = new Set(["yc", "startupmaps", "company_careers"]);
const JOB_BOARD_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com|bamboohr\.com|keka\.com|zohorecruit\.com|breezy\.hr)$/i;
const LINKEDIN_COMPANY = /^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/[A-Za-z0-9_%.-]+\/?$/i;

const hostOf = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");
/** Registrable-ish domain: last two labels (three for co.in / com.au style). Good enough to compare a site with its careers subdomain. */
function baseDomain(h: string) {
  const p = h.split(".");
  return p.length > 2 && /^(co|com|org|net|gov|ac)$/.test(p[p.length - 2]) ? p.slice(-3).join(".") : p.slice(-2).join(".");
}

export function resolveCompanyLinks(c: CompanyRecord | null): CompanyLinks {
  const out: CompanyLinks = {};
  if (!c) return out;
  const seen = new Set([...(c.sources_seen ?? []), c.source]);
  const trusted = [...seen].filter((s) => TRUSTED_ORIGINS.has(s));
  const isTrusted = trusted.length > 0;

  const site = safeHttpUrl(c.website);
  if (site && !/(^|\.)linkedin\.com$/.test(hostOf(site))) {
    out.website = { url: site, status: isTrusted ? "verified" : "unverified", basis: isTrusted ? `company record (${trusted[0]})` : "linked from a news article" };
  }

  const careers = safeHttpUrl(c.careers_url);
  if (careers && site) {
    const sameSite = baseDomain(hostOf(careers)) === baseDomain(hostOf(site));
    const board = JOB_BOARD_HOSTS.test(hostOf(careers));
    // A job-board link counts only when it came from the company's own site or a curated dataset, never from a search.
    if ((sameSite || board) && isTrusted) out.careers = { url: careers, status: "verified", basis: sameSite ? "on the company's own domain" : "job board linked from the company record" };
    else if (sameSite) out.careers = { url: careers, status: "unverified", basis: "same domain as an unverified website" };
  }

  const li = safeHttpUrl(c.linkedin_url);
  if (li && LINKEDIN_COMPANY.test(li)) out.linkedin = { url: li, status: isTrusted ? "verified" : "unverified", basis: isTrusted ? `company record (${trusted[0]})` : "unconfirmed source" };
  return out;
}

/** Same story text, different URL: a stable key from the headline's significant words. */
const STOP = new Set(["the", "a", "an", "in", "of", "to", "for", "and", "its", "at", "on", "with", "by", "from", "raises", "raised", "secures", "bags", "funding", "round", "led", "startup"]);
export function headlineFingerprint(headline: string): string | null {
  const toks = [...new Set(headline.toLowerCase().replace(/[^a-z0-9₹$ ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)))].sort();
  return toks.length >= 3 ? toks.join(" ") : null; // too short to be distinctive
}
