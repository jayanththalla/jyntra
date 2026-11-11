// Company link enrichment: official website, LinkedIn page and careers page for a funded company, WITH provenance.
//
// Rules enforced in code:
//  - A domain is NEVER guessed from the company name. Website candidates come only from links on the announcement page.
//  - A candidate becomes `websiteUrl` only if the site itself names the company (title, og:site_name, application-name or h1).
//  - Careers: a link on the verified site whose text/URL says careers/jobs, on the company's own domain or a known job-board host whose
//    path/subdomain carries the company name, and that actually answers. A careers URL is NOT a job opening and never creates one.
//  - LinkedIn: only a linkedin.com/company/<slug> link found on the company's own verified site (or an announcement anchor whose text
//    is the company name). Never built from a name, never taken from a search result.
//  - HTTPS only. Anything uncertain is left out and the result is "unverified". Every field records where it came from.
import { httpRequest } from "@/lib/ingestion/http";
import { safeHttpUrl } from "@/lib/url";
import { query } from "@/lib/database";

export interface LinkSource { field: "websiteUrl" | "linkedinUrl" | "careersUrl"; url: string; evidence: string }
export interface CompanyLinks {
  websiteUrl?: string; linkedinUrl?: string; careersUrl?: string;
  verificationStatus: "verified" | "partially_verified" | "unverified";
  sources: LinkSource[]; lastVerifiedAt?: string;
}
export type Page = { url: string; html: string };
export type FetchPage = (url: string) => Promise<Page | null>;

const SKIP_HOSTS = /(^|\.)(linkedin|twitter|x|facebook|instagram|youtube|medium|github|crunchbase|tracxn|pitchbook|google|apple|play\.google|bit\.ly|t\.co|wikipedia|techcrunch|inc42|entrackr|yourstory|economictimes|indiatimes|livemint|business-standard|moneycontrol|thehindu|forbes|reuters|bloomberg|vccircle|medianama|prnewswire|businesswire|globenewswire|substack|whatsapp|telegram|reddit|quora|feedburner|wordpress|blogspot)\.(com|co|in|net|org|be|me|io)$/i;
const JOB_BOARD = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com|bamboohr\.com|keka\.com|zohorecruit\.com|breezy\.hr|freshteam\.com|myworkdayjobs\.com|jobs\.gohire\.io)$/i;
const LINKEDIN_COMPANY = /^https:\/\/(?:www\.|[a-z]{2,3}\.)?linkedin\.com\/company\/([A-Za-z0-9_%.-]+)\/?(?:[?#].*)?$/i;
const CAREER_WORDS = /\b(careers?|jobs?|join (?:us|our team)|work with us|we(?:'|’)?re hiring|openings|open positions)\b/i;

const host = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
function baseDomain(h: string) { const p = h.split("."); return p.length > 2 && /^(co|com|org|net|gov|ac)$/.test(p[p.length - 2]!) ? p.slice(-3).join(".") : p.slice(-2).join("."); }
// STRICT key: the full name, letters and digits only. normalizeName() drops words such as "AI", "Labs" or "Technologies", which is right for
// matching records but wrong for deciding whether a website belongs to a company ("Zenith Dental Clinic" must not match "Zenith AI").
export const companyKey = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export interface Anchor { href: string; text: string }
export function anchors(html: string, base: string): Anchor[] {
  const out: Anchor[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /href\s*=\s*["']([^"'#][^"']*)["']/i.exec(m[1]!)?.[1]; if (!href) continue;
    try { const u = new URL(href.replace(/&amp;/g, "&"), base); if (u.protocol === "https:" || u.protocol === "http:") out.push({ href: u.toString(), text: decode(m[2]!).slice(0, 120) }); } catch { /* bad href */ }
  }
  return out;
}

/** Does this page say it belongs to `company`? Looks only at what the site calls itself. */
export function siteNamesCompany(html: string, company: string): string | null {
  const k = companyKey(company); if (k.length < 3) return null;
  const grab = (re: RegExp) => decode(re.exec(html)?.[1] ?? "");
  const cands: [string, string][] = [
    ["page title", grab(/<title[^>]*>([\s\S]*?)<\/title>/i)],
    ["og:site_name", grab(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) || grab(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i)],
    ["application-name", grab(/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i)],
    ["main heading", grab(/<h1[^>]*>([\s\S]*?)<\/h1>/i)],
  ];
  for (const [where, text] of cands) if (text && companyKey(text).includes(k)) return `${where} "${text.slice(0, 80)}" names ${company}`;
  return null;
}

function websiteCandidates(ann: Page, company: string): { url: string; why: string }[] {
  const k = companyKey(company); const annHost = baseDomain(host(ann.url));
  const out: { url: string; why: string; score: number }[] = [];
  for (const a of anchors(ann.html, ann.url)) {
    const h = host(a.href); if (!h || SKIP_HOSTS.test(h) || baseDomain(h) === annHost) continue;
    const t = companyKey(a.text); const hostKey = companyKey(baseDomain(h).split(".")[0] ?? "");
    const textMatch = t.length >= 3 && (t === k || t.includes(k) || k.includes(t) && t.length >= 4);
    const domainMatch = hostKey.length >= 3 && (hostKey === k || hostKey.includes(k) || k.includes(hostKey) && hostKey.length >= 4);
    const generic = /^(visit|official)?\s*(company\s*)?(website|site|homepage)$/i.test(a.text) || /^visit /i.test(a.text);
    if (textMatch || domainMatch || (generic && domainMatch)) out.push({ url: `https://${h}/`, why: textMatch ? `announcement links "${a.text}" to ${h}` : `announcement links to ${h}, a domain containing the company name`, score: (textMatch ? 2 : 0) + (domainMatch ? 2 : 0) });
  }
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score).filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true))).slice(0, 3);
}

function careersLink(site: Page, company: string): { url: string; why: string } | null {
  const k = companyKey(company); const sb = baseDomain(host(site.url));
  for (const a of anchors(site.html, site.url)) {
    if (!(CAREER_WORDS.test(a.text) || /\/(careers?|jobs)(\/|$)/i.test(new URL(a.href).pathname))) continue;
    const h = host(a.href); const u = new URL(a.href); if (u.protocol !== "https:") continue;
    if (baseDomain(h) === sb) return { url: a.href.split("#")[0]!, why: `link "${a.text || "careers"}" on the company's own website` };
    if (JOB_BOARD.test(h) && (companyKey(u.pathname).includes(k) || companyKey(h.split(".")[0] ?? "").includes(k))) return { url: a.href.split("#")[0]!, why: `link "${a.text || "careers"}" on the company's website to a job board page carrying the company name` };
  }
  return null;
}
function linkedinLink(site: Page, ann: Page | null, company: string): { url: string; why: string } | null {
  const fix = (u: string) => { const m = LINKEDIN_COMPANY.exec(u.split("?")[0]!.replace(/\/$/, "")); return m ? `https://www.linkedin.com/company/${m[1]}` : null; };
  for (const a of anchors(site.html, site.url)) { const l = fix(a.href); if (l) return { url: l, why: "LinkedIn link on the company's own verified website" }; }
  // From the announcement only when the page's slug IS the company name ("zenith-ai" for Zenith AI, not "zenith-ai-labs" or an investor).
  if (ann) for (const a of anchors(ann.html, ann.url)) { const l = fix(a.href); if (l && companyKey(company).length >= 3 && companyKey(l.split("/company/")[1] ?? "") === companyKey(company) && companyKey(a.text).includes(companyKey(company))) return { url: l, why: `announcement links "${a.text}" to a LinkedIn page whose name is exactly the company's` }; }
  return null;
}

/**
 * Pure resolution given a fetcher. `announcement` is the funding article page (optional). Returns links with provenance; anything
 * not verified is left out. No network happens except through `fetchPage`.
 */
export async function enrichCompany(company: string, announcement: Page | null, fetchPage: FetchPage, now = new Date()): Promise<CompanyLinks> {
  const sources: LinkSource[] = [];
  let site: Page | null = null;
  if (announcement) {
    for (const c of websiteCandidates(announcement, company)) {
      const p = await fetchPage(c.url).catch(() => null);
      const ev = p && siteNamesCompany(p.html, company);
      if (p && ev) { site = { url: p.url.startsWith("https://") ? p.url : c.url, html: p.html }; sources.push({ field: "websiteUrl", url: new URL(site.url).origin + "/", evidence: `${c.why}; ${ev}` }); break; }
    }
  }
  const out: CompanyLinks = { verificationStatus: "unverified", sources };
  if (!site) return out;
  out.websiteUrl = sources[0]!.url;
  const cl = careersLink(site, company);
  if (cl) { const page = await fetchPage(cl.url).catch(() => null); if (page) { out.careersUrl = cl.url; sources.push({ field: "careersUrl", url: cl.url, evidence: `${cl.why}; the page loads` }); } }
  const li = linkedinLink(site, announcement, company);
  if (li) { out.linkedinUrl = li.url; sources.push({ field: "linkedinUrl", url: li.url, evidence: li.why }); }
  out.verificationStatus = out.careersUrl && out.linkedinUrl ? "verified" : "partially_verified";
  out.lastVerifiedAt = now.toISOString();
  return out;
}

// ----------------------------------------------------------------------------------------------------------------------
export const enrichmentEnabled = (env: Record<string, string | undefined> = process.env) => (env.COMPANY_ENRICHMENT_ENABLED ?? "true").trim().toLowerCase() !== "false";

/** Safe page fetch: HTTPS only, SSRF-guarded by httpRequest, 1.5 MB cap. A non-200 or non-HTML page is simply "not there". */
export const defaultFetchPage: FetchPage = async (url) => {
  const safe = safeHttpUrl(url); if (!safe) return null;
  const https = safe.replace(/^http:\/\//i, "https://");
  try {
    const r = await httpRequest(https, { timeoutMs: 8000, maxBytes: 1_500_000, headers: { Accept: "text/html,application/xhtml+xml" } });
    return /<html|<head|<title/i.test(r.text) ? { url: https, html: r.text } : null;
  } catch { return null; }
};

export async function saveLinks(companyName: string, l: CompanyLinks, note?: string) {
  await query(
    `INSERT INTO company_link_checks (company_key, company_name, website_url, linkedin_url, careers_url, verification_status, sources, last_verified_at, last_attempt_at, attempt_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now(),$9)
     ON CONFLICT (company_key) DO UPDATE SET website_url=EXCLUDED.website_url, linkedin_url=EXCLUDED.linkedin_url, careers_url=EXCLUDED.careers_url,
       verification_status=EXCLUDED.verification_status, sources=EXCLUDED.sources, last_verified_at=COALESCE(EXCLUDED.last_verified_at, company_link_checks.last_verified_at),
       last_attempt_at=now(), attempt_note=EXCLUDED.attempt_note`,
    [companyKey(companyName), companyName.slice(0, 120), l.websiteUrl ?? null, l.linkedinUrl ?? null, l.careersUrl ?? null, l.verificationStatus, JSON.stringify(l.sources), l.lastVerifiedAt ?? null, note ?? null]);
}

export async function linksFor(companyNames: string[]): Promise<Map<string, CompanyLinks>> {
  const keys = [...new Set(companyNames.filter(Boolean).map(companyKey))]; const m = new Map<string, CompanyLinks>();
  if (!keys.length) return m;
  const rows = await query<{ company_key: string; website_url: string | null; linkedin_url: string | null; careers_url: string | null; verification_status: CompanyLinks["verificationStatus"]; sources: LinkSource[]; last_verified_at: string | null }>("SELECT company_key, website_url, linkedin_url, careers_url, verification_status, sources, last_verified_at FROM company_link_checks WHERE company_key = ANY($1)", [keys]);
  for (const r of rows) m.set(r.company_key, { ...(r.website_url ? { websiteUrl: r.website_url } : {}), ...(r.linkedin_url ? { linkedinUrl: r.linkedin_url } : {}), ...(r.careers_url ? { careersUrl: r.careers_url } : {}), verificationStatus: r.verification_status, sources: r.sources, ...(r.last_verified_at ? { lastVerifiedAt: new Date(r.last_verified_at).toISOString() } : {}) });
  return m;
}

/** Enriches up to `limit` recent funded companies that have no check yet (or a failed one older than 7 days). Polite: sequential, bounded. */
export async function enrichPending(limit = 5, fetchPage: FetchPage = defaultFetchPage): Promise<{ checked: number; verified: number; partial: number; unverified: number }> {
  const rows = await query<{ company_name: string; url: string }>(
    `SELECT DISTINCT ON (a.company_name) a.company_name, a.url FROM funding_articles a
     WHERE a.company_name IS NOT NULL AND a.published_at > now() - interval '120 days'
       AND NOT EXISTS (SELECT 1 FROM company_link_checks c WHERE lower(c.company_name) = lower(a.company_name) AND (c.verification_status <> 'unverified' OR c.last_attempt_at > now() - interval '7 days'))
     ORDER BY a.company_name, a.published_at DESC LIMIT $1`, [limit]);
  const r = { checked: 0, verified: 0, partial: 0, unverified: 0 };
  for (const row of rows) {
    const ann = await fetchPage(row.url);
    const links = await enrichCompany(row.company_name, ann, fetchPage);
    await saveLinks(row.company_name, links, ann ? (links.websiteUrl ? undefined : "no candidate website on the announcement page named the company") : "announcement page could not be read");
    r.checked++; if (links.verificationStatus === "verified") r.verified++; else if (links.verificationStatus === "partially_verified") r.partial++; else r.unverified++;
  }
  return r;
}
