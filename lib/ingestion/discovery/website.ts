// Website → careers page → ATS. Only follows what the company's own pages link to; never guesses a slug from a name.
import { httpRequest, USER_AGENT } from "../http";
import { detectAts, type Detected } from "../providers/detect";

const CAREER_PATHS = ["/careers", "/jobs", "/careers/", "/about/careers", "/company/careers", "/join-us"];
const CAREER_LINK = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>\s*(?:<[^>]+>\s*)*(careers?|jobs?|join us|we[’']?re hiring|work with us|open (?:roles|positions))\b/gi;

export interface ResolveResult { ats: Detected | null; careersUrl: string | null; pagesChecked: string[]; foundIn: string | null; note?: string }

/** Minimal robots.txt check (User-agent: * and our own name, longest match wins). A missing/unreadable robots.txt allows. */
export async function robotsAllowsPath(origin: string, pathname: string): Promise<boolean> {
  try {
    const r = await httpRequest(`${origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 200_000, headers: { Accept: "text/plain" } });
    const rules: { allow: boolean; path: string }[] = [];
    let applies = false, sawRule = false;
    for (const raw of r.text.split(/\r?\n/)) {
      const m = raw.replace(/#.*/, "").trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const k = m[1]!.toLowerCase(), v = m[2]!.trim();
      if (k === "user-agent") { if (sawRule) { applies = false; sawRule = false; } if (v === "*" || /jyntra/i.test(v)) applies = true; }
      else if ((k === "allow" || k === "disallow") && v) { sawRule = true; if (applies) rules.push({ allow: k === "allow", path: v }); }
    }
    const hit = rules.filter((x) => pathname.startsWith(x.path.replace(/\*.*$/, "").replace(/\$$/, ""))).sort((a, b) => b.path.length - a.path.length)[0];
    return hit ? hit.allow : true;
  } catch {
    return true;
  }
}

async function page(url: string, checked: string[]): Promise<string | null> {
  const u = new URL(url);
  if (!(await robotsAllowsPath(u.origin, u.pathname))) return null;
  checked.push(url);
  try {
    const r = await httpRequest(url, { timeoutMs: 12_000, maxBytes: 2_000_000, headers: { Accept: "text/html", "User-Agent": USER_AGENT } });
    return r.text;
  } catch {
    return null;
  }
}

export async function resolveCareers(websiteUrl: string): Promise<ResolveResult> {
  const checked: string[] = [];
  let origin: string;
  try { origin = new URL(websiteUrl).origin; } catch { return { ats: null, careersUrl: null, pagesChecked: [], foundIn: null, note: "invalid website URL" }; }
  const home = await page(origin + "/", checked);
  let careersUrl: string | null = null;
  if (home) {
    const direct = detectAts(home);
    if (direct) return { ats: direct, careersUrl: direct.sourceUrl, pagesChecked: checked, foundIn: origin + "/" };
    for (const m of home.matchAll(CAREER_LINK)) {
      try { const u = new URL(m[1]!, origin + "/"); if (u.protocol === "https:") { careersUrl = u.toString(); break; } } catch { /* skip */ }
    }
  }
  const tries = [...(careersUrl ? [careersUrl] : []), ...CAREER_PATHS.map((p) => origin + p)].slice(0, 5);
  for (const u of tries) {
    const viaUrl = detectAts(u); // the link itself may already point at the ATS
    if (viaUrl) return { ats: viaUrl, careersUrl: u, pagesChecked: checked, foundIn: u };
    const html = await page(u, checked);
    if (!html) continue;
    careersUrl ??= u;
    const d = detectAts(html);
    if (d) return { ats: d, careersUrl: u, pagesChecked: checked, foundIn: u };
  }
  return { ats: null, careersUrl, pagesChecked: checked, foundIn: null, note: careersUrl ? "careers page found but no supported ATS detected" : "no careers page found" };
}
