// BLR Startup Arena (blrstartuparena.com): a Bengaluru startup directory with a per-company jobs endpoint,
//   GET https://www.blrstartuparena.com/api/companies/<slug>/jobs
// Public JSON. Empty applyUrl stays null (never replaced with the company page). robots.txt is respected.
// The provider is OFF until BLRARENA_ENABLED=true. Company-job sync is a separate scheduler scope.
import fs from "node:fs";
import path from "node:path";
import type { DiscoveryContext, JobResult, StartupResult, StartupSource } from "@/lib/types";
import { cachedTextInfo, errorCategory } from "@/lib/http";
import { blrArenaEnabled } from "@/lib/providers/config";
import { mapCompanyApiJob, jobsArrayFromBody } from "@/lib/company-jobs/adapter";
import { companyJobToJobResult } from "@/lib/company-jobs/to-job-result";

const BASE = process.env.BLRARENA_BASE_URL || "https://www.blrstartuparena.com";
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const MAX_COMPANIES = 1000;

const pick = (o: any, keys: string[]): string | null => {
  for (const k of keys) { const v = o?.[k]; if (typeof v === "string" && v.trim()) return v.trim(); }
  return null;
};
const parse = (body: string): any => { try { return JSON.parse(body); } catch { throw new Error("response was not JSON"); } };

/** One job object → discovery JobResult. applyUrl is only the source's applyUrl, never the company page. */
export function arenaJob(j: any, slug: string): JobResult | null {
  const mapped = mapCompanyApiJob(j, slug, { companyPage: `${BASE}/companies/${slug}`, source: "blrarena" });
  if (!mapped) return null;
  return companyJobToJobResult(mapped);
}

export const prettyName = (slug: string) => (slug.length <= 3 ? slug.toUpperCase() : slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));

export type Fetcher = (url: string) => Promise<string | null>;

const defaultFetcher: Fetcher = async (url) => {
  try {
    return (await cachedTextInfo(url, 6, { allowStale: false, validate: (b) => void parse(b), headers: { Accept: "application/json" } })).body;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
};

function configuredSlugs(env = process.env): string[] {
  const out = new Set<string>();
  for (const s of (env.BLRARENA_COMPANY_SLUGS ?? "").split(",")) out.add(s.trim().toLowerCase());
  try { for (const s of fs.readFileSync(path.join(process.cwd(), "data", "blrarena-slugs.txt"), "utf8").split(/\r?\n/)) out.add(s.trim().toLowerCase()); } catch { /* optional file */ }
  return [...out].filter((s) => SLUG.test(s));
}

export async function discoverBlrArena(ctx: Pick<DiscoveryContext, "log">, fetchText: Fetcher = defaultFetcher, slugsFromConfig: string[] = configuredSlugs()): Promise<StartupResult[]> {
  const names = new Map<string, string>();
  for (const s of slugsFromConfig) names.set(s, prettyName(s));
  try {
    const list = await fetchText(`${BASE}/api/companies`);
    for (const c of list ? (Array.isArray(parse(list)) ? parse(list) : jobsArrayFromBody(parse(list)) ?? []) : []) {
      const slug = (pick(c, ["slug", "id", "handle"]) ?? "").toLowerCase();
      if (SLUG.test(slug)) names.set(slug, pick(c, ["name", "company", "title"]) ?? slug);
    }
  } catch (e) {
    ctx.log(`BLR Startup Arena: company list not available (${errorCategory(e)}); using configured slugs only`);
  }
  if (!names.size) { ctx.log("BLR Startup Arena: no company slugs known. Set BLRARENA_COMPANY_SLUGS or data/blrarena-slugs.txt."); return []; }
  const out: StartupResult[] = [];
  let withJobs = 0, none = 0, failed = 0;
  for (const [slug, name] of [...names].slice(0, MAX_COMPANIES)) {
    try {
      const body = await fetchText(`${BASE}/api/companies/${slug}/jobs`);
      const jobs = (body ? (jobsArrayFromBody(parse(body)) ?? []) : []).map((j) => arenaJob(j, slug)).filter((j): j is JobResult => !!j);
      if (!jobs.length) { none++; continue; }
      withJobs++;
      out.push({ name, source: "blrarena", sourceUrl: `${BASE}/companies/${slug}`, location: "Bengaluru, India", allowWithoutFunding: true, jobs, jobsComplete: false });
    } catch (e) {
      failed++;
      ctx.log(`BLR Startup Arena: ${slug} failed (${errorCategory(e)})`);
    }
  }
  ctx.log(`BLR Startup Arena: ${withJobs} companies with jobs, ${none} without a jobs endpoint or jobs, ${failed} failed.`);
  if (failed && !withJobs && !none) throw new Error("BLR Startup Arena could not be read");
  return out;
}

export const blrArenaSource: StartupSource = {
  id: "blrarena",
  name: "BLR Startup Arena",
  disabledReason: () => (blrArenaEnabled() ? null : "off by default; set BLRARENA_ENABLED=true"),
  discover: (ctx: DiscoveryContext) => discoverBlrArena(ctx),
};
