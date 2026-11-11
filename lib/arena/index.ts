// Read model for the scraped BLR Startup Arena listings (data/blrarena-jobs.json, written by `npm run blrarena:jobs`).
// No database: the file is parsed once per server process and everything below is computed from it.
// Nothing here is estimated: counts are counts of rows in the file.
import fs from "node:fs";
import path from "node:path";
import { applicationUrlOrNull } from "@/lib/company-jobs/urls";
import { EXPERIENCE_ORDER, MODE_LABEL, experienceBand, familyLabel, shortLocation, type ArenaJob, type CompanyCard } from "./shared";

export * from "./shared";

export interface ArenaCompany {
  slug: string;
  name: string;
  page: string;
  jobs: ArenaJob[]; // newest first
}
export interface ArenaData { fetchedAt: string | null; companies: ArenaCompany[]; bySlug: Map<string, ArenaCompany>; totalJobs: number }

const FILE = path.join(process.cwd(), "data", "blrarena-jobs.json");
let cache: { mtime: number; data: ArenaData } | null = null;

const MODES = new Set(["remote", "hybrid", "onsite"]);
const prettySlug = (slug: string) => slug.split("-").map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");

/** Job summaries start with the company's own spelling ("PwC is…"). When they begin with the slug's words, use that casing. */
function betterName(slug: string, summary: string | undefined): string {
  const base = prettySlug(slug);
  if (!summary) return base;
  const words = slug.split("-");
  const head = summary.split(/\s+/).slice(0, words.length);
  if (head.length === words.length && head.every((w, i) => w.replace(/[^a-z0-9]/gi, "").toLowerCase() === words[i].toLowerCase())) return head.join(" ").replace(/[,.;:]+$/, "");
  return base;
}

export function loadArena(): ArenaData {
  let mtime = 0;
  try { mtime = fs.statSync(FILE).mtimeMs; } catch { return { fetchedAt: null, companies: [], bySlug: new Map(), totalJobs: 0 }; }
  if (cache && cache.mtime === mtime) return cache.data;
  const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as { fetched_at?: string; jobs?: Record<string, unknown>[] };
  const today = new Date().toISOString().slice(0, 10);
  const map = new Map<string, ArenaCompany>();
  for (const r of raw.jobs ?? []) {
    const slug = String(r.slug ?? "");
    if (!slug) continue;
    let c = map.get(slug);
    if (!c) map.set(slug, (c = { slug, name: betterName(slug, r.summary as string | undefined), page: String(r.company_page ?? ""), jobs: [] }));
    const posted = typeof r.posted === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.posted) && r.posted <= today ? r.posted : null;
    const mode = String(r.work_mode ?? "unknown");
    const companyPage = String(r.company_page ?? c.page ?? "");
    const rawApply = typeof r.application_url === "string" && r.application_url ? r.application_url : typeof r.apply_url === "string" ? r.apply_url : "";
    const applicationUrl = applicationUrlOrNull(rawApply, companyPage, slug);
    c.jobs.push({
      id: String(r.job_id ?? `${slug}-${c.jobs.length}`),
      title: String(r.title ?? "Untitled role"),
      location: (r.location as string) || null,
      mode: MODES.has(mode) ? (mode as ArenaJob["mode"]) : "unknown",
      type: String(r.employment_type ?? "unknown"),
      posted,
      experience: (r.experience as string) || null,
      salary: (r.salary as string) || null,
      family: String(r.role_family ?? "other"),
      fresher: r.fresher_friendly === true,
      applicationUrl,
      applyUrl: applicationUrl,
      jobDetailUrl: null,
      seniority: typeof r.seniority === "string" ? r.seniority : null,
      summary: String(r.summary ?? ""),
    });
  }
  const companies = [...map.values()];
  for (const c of companies) c.jobs.sort((a, b) => (b.posted ?? "").localeCompare(a.posted ?? ""));
  companies.sort((a, b) => b.jobs.length - a.jobs.length || a.name.localeCompare(b.name));
  const data: ArenaData = { fetchedAt: raw.fetched_at ?? null, companies, bySlug: map, totalJobs: companies.reduce((n, c) => n + c.jobs.length, 0) };
  cache = { mtime, data };
  return data;
}

const daysAgo = (iso: string, now: number) => Math.floor((now - Date.parse(iso + "T00:00:00Z")) / 86_400_000);

export interface ArenaOverview {
  fetchedAt: string | null;
  totals: { jobs: number; companies: number; fresher: number; remote: number; last30: number; last7: number; latestPosted: string | null };
  families: { key: string; label: string; count: number }[];
  modes: { key: ArenaJob["mode"]; label: string; count: number }[];
  experience: { label: string; count: number }[];
  weekly: { week: string; count: number }[]; // last 8 weeks, oldest first
  topCompanies: { slug: string; name: string; count: number; fresher: number }[];
  fastestGrowing: { slug: string; name: string; recent: number; total: number }[];
  freshers: { slug: string; company: string; job: ArenaJob }[];
  newest: { slug: string; company: string; job: ArenaJob }[];
}

export function arenaOverview(): ArenaOverview {
  const { companies, fetchedAt, totalJobs } = loadArena();
  const now = Date.now();
  const fam = new Map<string, number>(), mode = new Map<ArenaJob["mode"], number>(), exp = new Map<string, number>();
  const weeks = new Array<number>(8).fill(0);
  // Weeks end at the newest posting in the file, not at today, so a scrape a few days old doesn't end with an empty bar.
  let anchor = 0;
  for (const c of companies) for (const j of c.jobs) if (j.posted) anchor = Math.max(anchor, Date.parse(j.posted + "T00:00:00Z"));
  if (!anchor) anchor = now;
  let fresher = 0, remote = 0, last30 = 0, last7 = 0, latest: string | null = null;
  const all: { slug: string; company: string; job: ArenaJob }[] = [];
  const growth: ArenaOverview["fastestGrowing"] = [];
  for (const c of companies) {
    let recent = 0;
    for (const j of c.jobs) {
      fam.set(j.family, (fam.get(j.family) ?? 0) + 1);
      mode.set(j.mode, (mode.get(j.mode) ?? 0) + 1);
      const band = experienceBand(j.experience, j.fresher);
      exp.set(band, (exp.get(band) ?? 0) + 1);
      if (j.fresher) fresher++;
      if (j.mode === "remote") remote++;
      all.push({ slug: c.slug, company: c.name, job: j });
      if (j.posted) {
        if (!latest || j.posted > latest) latest = j.posted;
        const d = daysAgo(j.posted, now);
        if (d <= 30) { last30++; recent++; }
        if (d <= 7) last7++;
        const wd = Math.floor((anchor - Date.parse(j.posted + "T00:00:00Z")) / 86_400_000);
        if (wd >= 0 && wd < 56) weeks[7 - Math.floor(wd / 7)]++;
      }
    }
    if (recent > 0) growth.push({ slug: c.slug, name: c.name, recent, total: c.jobs.length });
  }
  const weekStart = (i: number) => new Date(anchor - (7 - i) * 7 * 86_400_000 - 6 * 86_400_000).toISOString().slice(0, 10);
  const byDate = (a: { job: ArenaJob }, b: { job: ArenaJob }) => (b.job.posted ?? "").localeCompare(a.job.posted ?? "");
  return {
    fetchedAt,
    totals: { jobs: totalJobs, companies: companies.length, fresher, remote, last30, last7, latestPosted: latest },
    families: [...fam].map(([key, count]) => ({ key, label: familyLabel(key), count })).sort((a, b) => b.count - a.count),
    modes: (["hybrid", "onsite", "remote", "unknown"] as const).map((key) => ({ key, label: MODE_LABEL[key], count: mode.get(key) ?? 0 })),
    experience: EXPERIENCE_ORDER.map((label) => ({ label, count: exp.get(label) ?? 0 })),
    weekly: weeks.map((count, i) => ({ week: weekStart(i), count })),
    topCompanies: companies.slice(0, 8).map((c) => ({ slug: c.slug, name: c.name, count: c.jobs.length, fresher: c.jobs.filter((j) => j.fresher).length })),
    fastestGrowing: growth.sort((a, b) => b.recent - a.recent).slice(0, 6),
    freshers: all.filter((r) => r.job.fresher).sort(byDate).slice(0, 6),
    newest: all.sort(byDate).slice(0, 6),
  };
}


export function companyCards(): CompanyCard[] {
  const now = Date.now();
  return loadArena().companies.map((c) => {
    const fam = new Map<string, number>();
    const locs = new Map<string, number>();
    for (const j of c.jobs) {
      fam.set(j.family, (fam.get(j.family) ?? 0) + 1);
      const sl = shortLocation(j.location);
      if (sl) locs.set(sl, (locs.get(sl) ?? 0) + 1);
    }
    // Pick the most common location
    let topLoc: string | null = null;
    let topCount = 0;
    for (const [loc, n] of locs) { if (n > topCount) { topLoc = loc; topCount = n; } }
    return {
      slug: c.slug, name: c.name, count: c.jobs.length,
      fresher: c.jobs.filter((j) => j.fresher).length,
      recent: c.jobs.filter((j) => j.posted && daysAgo(j.posted, now) <= 30).length,
      remote: c.jobs.filter((j) => j.mode === "remote").length,
      families: [...fam].sort((a, b) => b[1] - a[1]).map(([k]) => k), // all role families, most openings first
      latest: c.jobs[0]?.posted ?? null,
      location: topLoc,
      logoSrc: `/api/companies/${c.slug}/logo`,
      city: "Bengaluru",
    };
  });
}
