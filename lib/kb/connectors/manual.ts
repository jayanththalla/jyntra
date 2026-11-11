// Manual / user-provided connectors. We never fetch linkedin.com (no scraping, no login bypass): the candidate pastes
// their profile text. The portfolio connector fetches one public web page the user names, with SSRF protection.
import dns from "node:dns/promises";
import net from "node:net";
import { redactSecrets } from "../safety";
import { SourceError, type Connector, type RawDoc, type SyncContext, type SyncResult } from "../types";

const MAX_TEXT = 100_000;

const SECTIONS: [string, RegExp][] = [
  ["experience", /^(work\s+)?experience|employment|internships?$/i],
  ["education", /^education|academics?$/i],
  ["skills", /^(top\s+|technical\s+)?skills|technologies$/i],
  ["certifications", /^(licenses\s*(&|and)\s*)?certifications?|licenses$/i],
  ["projects", /^projects?$/i],
  ["achievements", /^(honors\s*(&|and)\s*awards|awards|achievements)$/i],
  ["summary", /^(about|summary|profile)$/i],
];

/** Splits pasted profile text by headings. Text before the first heading is the headline/summary. */
export function splitProfileSections(text: string): { section: string; content: string }[] {
  const out: { section: string; lines: string[] }[] = [{ section: "headline", lines: [] }];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim().replace(/^#+\s*/, "").replace(/:$/, "");
    const hit = line.length < 40 ? SECTIONS.find(([, re]) => re.test(line)) : undefined;
    if (hit) out.push({ section: hit[0], lines: [] });
    else out[out.length - 1].lines.push(raw);
  }
  return out.map((s) => ({ section: s.section, content: s.lines.join("\n").trim() })).filter((s) => s.content);
}

const linkedinUrl = (u: unknown): string | null => {
  const m = typeof u === "string" ? u.trim().match(/^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]{2,100}\/?$/i) : null;
  return m ? m[0] : null;
};

export const manualConnector: Connector = {
  provider: "linkedin",
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const text = typeof ctx.config.text === "string" ? ctx.config.text : "";
    if (text.length > MAX_TEXT) throw new SourceError("invalid", "The pasted text is larger than 100 KB.");
    if (text.trim().length < 20) throw new SourceError("invalid", "Paste your profile text (headline, experience, education, skills).");
    const url = linkedinUrl(ctx.config.profileUrl);
    if (ctx.config.profileUrl && !url) throw new SourceError("invalid", "Use a profile URL like https://www.linkedin.com/in/yourname.");
    const label = ctx.config.kind === "notes" ? "Notes" : ctx.config.kind === "portfolio" ? "Portfolio" : "LinkedIn profile (pasted by the candidate)";
    const docs: RawDoc[] = splitProfileSections(text).map((s) => ({
      externalId: `${ctx.config.kind ?? "linkedin"}:${s.section}`, docType: ctx.config.kind === "notes" ? "note" : "profile", title: `${label}: ${s.section}`, url,
      content: redactSecrets(s.content).text, metadata: { section: s.section, userProvided: true, technologies: [] },
    }));
    return { docs, complete: true, warnings: [] };
  },
};

// ---------- portfolio (public web page) ----------
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::" || l.startsWith("fe80") || /^f[cd]/.test(l)) return true;
    const m = l.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateAddress(m[1]) : false;
  }
  return true;
}

let resolver: (host: string) => Promise<string[]> = async (h) => (await dns.lookup(h, { all: true })).map((a) => a.address);
/** Tests replace DNS so no network is used. */
export const setHostResolver = (fn: (host: string) => Promise<string[]>) => { resolver = fn; };

/** Throws SourceError('invalid') unless the URL is a public http(s) address. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SourceError("invalid", "That isn't a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SourceError("invalid", "Only http and https links are allowed.");
  if (u.username || u.password) throw new SourceError("invalid", "Links with embedded credentials are not allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new SourceError("invalid", "That address is not public.");
  const ips = net.isIP(host) ? [host] : await resolver(host).catch(() => []);
  if (!ips.length || ips.some(isPrivateAddress)) throw new SourceError("invalid", "That address is not public.");
  return u;
}

const MAX_PAGE = 500_000;

export function htmlToText(html: string): string {
  return html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<\/(p|div|li|h[1-6]|section|br|tr)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

export const portfolioConnector: Connector = {
  provider: "portfolio",
  async sync(ctx: SyncContext): Promise<SyncResult> {
    let url = await assertPublicUrl(String(ctx.config.url ?? ""));
    for (let hop = 0; hop < 4; hop++) {
      let res: Response;
      try {
        res = await ctx.fetchImpl(url.toString(), { redirect: "manual", headers: { Accept: "text/html", "User-Agent": "Jyntra-KB" }, signal: AbortSignal.timeout(15_000) });
      } catch {
        throw new SourceError("unavailable", "The site could not be reached.");
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new SourceError("unavailable", "The site redirected without a location.");
        url = await assertPublicUrl(new URL(loc, url).toString()); // re-checked on every redirect
        continue;
      }
      if (res.status === 404) throw new SourceError("not_found", "That page was not found.");
      if (!res.ok) throw new SourceError("unavailable", `The site answered HTTP ${res.status}.`);
      if (!/text\/html|application\/xhtml/i.test(res.headers.get("content-type") ?? "")) throw new SourceError("invalid", "Only HTML pages can be imported.");
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_PAGE) throw new SourceError("invalid", "The page is larger than 500 KB.");
      const body = (await res.text()).slice(0, MAX_PAGE);
      const text = htmlToText(body);
      if (text.length < 20) throw new SourceError("invalid", "No readable text was found on that page.");
      const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 120) || url.hostname;
      return { docs: [{ externalId: `portfolio:${url.origin}${url.pathname}`, docType: "doc", title: `Portfolio: ${title}`, url: url.toString(), content: redactSecrets(text.slice(0, 60_000)).text, metadata: { technologies: [], userProvided: true } }], complete: true, warnings: [] };
    }
    throw new SourceError("unavailable", "Too many redirects.");
  },
};
