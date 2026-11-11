// Hyderabad startup directory, read from an OPEN dataset on GitHub: github.com/shivtchandra/hydstartuplist
// (MIT, © Mapping HYD; the data behind startups.mapmyhyd.com, ~1,200 startups, committed to almost daily).
//
// Why not hyderabadstartupsmap.lol? Its robots.txt disallows /api/startups, and this app honours robots.txt,
// so that source could never run. raw.githubusercontent.com publishes no robots.txt and the repo is MIT, so
// reading the file is both allowed and attributed (see docs/SOURCES.md).
//
// Entry fields used: id, name, website, sector, fundingStage, area, address, description, oneLiner, careers,
// founded, hiring { active, count, roles[{title,url}], checkedAt }.
import type { DiscoveryContext, JobResult, StartupResult, StartupSource } from "@/lib/types";
import { cachedJson } from "@/lib/http";
import { settings } from "@/config/settings";

export const SOURCE_ID = "startupmaps";
export const DATASET_URL = "https://raw.githubusercontent.com/shivtchandra/hydstartuplist/master/data/startups.json";
export const MAP_URL = "https://startups.mapmyhyd.com/";
/** The file changes several times a day; half an hour keeps it live without hammering GitHub. */
const CACHE_HOURS = 0.5;

export interface MapStartup {
  id: string;
  name: string;
  website?: string | null;
  sector?: string | null;
  fundingStage?: string | null;
  area?: string | null;
  address?: string | null;
  description?: string | null;
  oneLiner?: string | null;
  careers?: string | null;
  founded?: number | null;
  status?: string | null;
  hiring?: { active?: boolean; count?: number; roles?: { title?: string; url?: string }[]; checkedAt?: string | null } | null;
}

/** The dataset is Hyderabad-first but a few rows sit elsewhere; the address decides the city. */
export function cityOf(place: string | null | undefined): string {
  if (/bengaluru|bangalore/i.test(place ?? "")) return "Bengaluru";
  return "Hyderabad";
}

const httpUrl = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try {
    const x = new URL(u.trim());
    return x.protocol === "https:" || x.protocol === "http:" ? u.trim() : null; // keep the listed spelling
  } catch {
    return null;
  }
};

/**
 * Open roles from the dataset are only trusted when the dataset itself checked the board recently:
 * a two-month-old snapshot of "19 open roles" is exactly the stale-jobs problem this app must not show.
 * No posting date is claimed (the file has none); the app dates undated jobs from the day we first saw them.
 */
export function freshRoles(s: MapStartup, now = new Date()): JobResult[] {
  const h = s.hiring;
  if (!h?.active || !h.checkedAt || !Array.isArray(h.roles)) return [];
  const age = (now.getTime() - new Date(h.checkedAt).getTime()) / 86_400_000;
  if (!(age >= 0 && age <= settings.newJobDays)) return [];
  const out: JobResult[] = [];
  for (const r of h.roles) {
    const url = httpUrl(r.url);
    if (!r.title?.trim() || !url) continue;
    out.push({
      title: r.title.trim(),
      url,
      remote: "unknown",
      location: cityOf(s.address ?? s.area),
      source: SOURCE_ID,
      sourceUrl: MAP_URL,
      externalId: `${SOURCE_ID}:${s.id}:${url}`,
      verification: "source_api",
    });
  }
  return out;
}

export function mapToStartup(s: MapStartup, now = new Date()): StartupResult {
  const city = cityOf(s.address ?? s.area);
  const place = s.address || s.area || city;
  const tags = [s.sector, s.fundingStage, s.area && !/^others$/i.test(s.area) ? s.area : null].filter((t): t is string => !!t);
  const jobs = freshRoles(s, now);
  return {
    name: s.name.trim(),
    website: httpUrl(s.website),
    careersUrl: httpUrl(s.careers),
    description: (s.oneLiner || s.description || "").trim() || null,
    location: place,
    tags,
    industryHint: s.sector ?? null,
    foundedYear: typeof s.founded === "number" && s.founded > 1900 && s.founded <= now.getFullYear() ? s.founded : null,
    hq: {
      country: "India",
      confidence: "medium",
      evidence: `Listed in the open Hyderabad startup dataset (Mapping HYD): ${place}`,
      sourceUrl: MAP_URL,
    },
    source: SOURCE_ID,
    sourceUrl: MAP_URL,
    allowWithoutFunding: true,
    ...(jobs.length ? { jobs } : {}),
  };
}

export const startupMapsSource: StartupSource = {
  id: SOURCE_ID,
  name: "Hyderabad startup dataset (GitHub, MIT)",
  disabledReason: () => null,

  async discover(ctx: DiscoveryContext): Promise<StartupResult[]> {
    // A failure here propagates: the run records this source as failed instead of "0 startups today".
    const rows = await cachedJson<MapStartup[]>(DATASET_URL, CACHE_HOURS);
    if (!Array.isArray(rows)) throw new Error("unexpected response (expected a JSON array)");
    const seen = new Set<string>();
    const ok = rows.filter((r) => {
      if (!r || typeof r.id !== "string" || typeof r.name !== "string" || !r.name.trim()) return false;
      if (r.status && r.status !== "approved") return false;
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    const results = ok.map((r) => mapToStartup(r));
    ctx.log(`Hyderabad dataset: ${results.length} startups, ${results.filter((r) => r.jobs?.length).length} with openings checked in the last ${settings.newJobDays} days.`);
    return results;
  },
};
