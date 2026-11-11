// Finds the ATS behind a careers URL (or a careers page's HTML). Pure string matching: no network.
import type { JobSource, ProviderId } from "../types";

export interface Detected { provider: ProviderId; boardSlug: string | null; tenant: string | null; host: string | null; careerSite: string | null; sourceUrl: string }

const GENERIC_SUB = new Set(["www", "api", "app", "jobs", "careers", "boards", "apply", "help", "support", "docs", "static", "assets", "cdn", "mail"]);
const PATTERNS: { re: RegExp; make: (m: RegExpExecArray) => Omit<Detected, "sourceUrl"> | null }[] = [
  { re: /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/i, make: (m) => gh(m[1]!) },
  { re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/i, make: (m) => (["embed", "v1"].includes(m[1]!.toLowerCase()) ? null : gh(m[1]!)) },
  { re: /jobs\.(eu\.)?lever\.co\/([A-Za-z0-9_.-]+)/i, make: (m) => ({ provider: "lever", boardSlug: m[2]!, tenant: null, host: m[1] ? "eu" : null, careerSite: null }) },
  { re: /jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/i, make: (m) => ({ provider: "ashby", boardSlug: decodeURIComponent(m[1]!), tenant: null, host: null, careerSite: null }) },
  { re: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_.%-]+)/i, make: (m) => ({ provider: "smartrecruiters", boardSlug: decodeURIComponent(m[1]!), tenant: null, host: null, careerSite: null }) },
  { re: /apply\.workable\.com\/([A-Za-z0-9_-]+)/i, make: (m) => (m[1]!.toLowerCase() === "api" || m[1]!.toLowerCase() === "j" ? null : { provider: "workable", boardSlug: m[1]!, tenant: null, host: null, careerSite: null }) },
  { re: /\/\/([a-z0-9-]+)\.recruitee\.com/i, make: (m) => sub("recruitee", m[1]!) },
  { re: /\/\/([a-z0-9-]+)\.breezy\.hr/i, make: (m) => sub("breezy", m[1]!) },
  { re: /\/\/([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/i, make: (m) => sub("personio", m[1]!) },
  { re: /\/\/([a-z0-9-]+)\.keka\.com\/careers/i, make: (m) => sub("keka", m[1]!) },
  { re: /\/\/([a-z0-9-]+)\.darwinbox\.in(?:\/ms\/candidatev2\/([a-z0-9]+))?/i, make: (m) => (GENERIC_SUB.has(m[1]!.toLowerCase()) ? null : { provider: "darwinbox", boardSlug: m[1]!, tenant: null, host: null, careerSite: m[2] ?? null }) },
  { re: /\/\/([a-z0-9-]+)\.(fa(?:\.[a-z0-9-]{1,20}){0,2})\.oraclecloud\.com\/hcmUI\/CandidateExperience\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?sites\/([A-Za-z0-9_]{1,40})/i, make: (m) => ({ provider: "oracle", boardSlug: null, tenant: m[1]!, host: m[2]!.toLowerCase(), careerSite: m[3]! }) },
  { re: /\/\/([a-z0-9-]+)\.eightfold\.ai/i, make: (m) => sub("eightfold", m[1]!) },
  { re: /\/\/([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/i, make: (m) => ({ provider: "workday", boardSlug: null, tenant: m[1]!, host: m[2]!.toLowerCase(), careerSite: m[3]! }) },
];
const gh = (slug: string) => ({ provider: "greenhouse" as const, boardSlug: slug, tenant: null, host: null, careerSite: null });
const sub = (provider: ProviderId, s: string) => (GENERIC_SUB.has(s.toLowerCase()) ? null : { provider, boardSlug: s, tenant: null, host: null, careerSite: null });

/** First ATS reference found in `text` (a URL or HTML). null when none is recognised. */
export function detectAts(text: string | null | undefined): Detected | null {
  if (!text) return null;
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const d = p.make(m);
    if (d) return { ...d, sourceUrl: m[0].startsWith("http") ? m[0] : `https://${m[0].replace(/^\/\//, "")}` };
  }
  return null;
}

export function toSource(companySlug: string, d: Detected): JobSource {
  return { id: null, companySlug, provider: d.provider, boardSlug: d.boardSlug, tenant: d.tenant, host: d.host, careerSite: d.careerSite, sourceUrl: d.sourceUrl, etag: null, lastModified: null, config: d.provider === "lever" && d.host === "eu" ? { region: "eu" } : {} };
}
