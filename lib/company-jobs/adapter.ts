// Dedicated mapper for GET /api/companies/{slug}/jobs (BLR Startup Arena).
// Missing values stay null. applyUrl is never invented from the slug, title, or company page.
import { normalizeEmploymentType } from "@/lib/normalize";
import { stripHtml } from "@/lib/text";
import { applicationUrlOrNull } from "./urls";

export interface CompanyJobRecord {
  externalJobId: string | null;
  title: string;
  normalizedTitle: string | null;
  seniority: string | null;
  workMode: "remote" | "hybrid" | "onsite" | "unknown";
  employmentType: string | null;
  location: string | null;
  applicationUrl: string | null;
  jobDetailUrl: string | null;
  postedAt: string | null;
  fresherFriendly: boolean | null;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryEstimated: boolean | null;
  description: string | null;
  roleFamily: string | null;
  source: string;
  companySlug: string;
}

const MODES = new Set(["remote", "hybrid", "onsite"]);
const pick = (o: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export function jobsArrayFromBody(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const k of ["jobs", "data", "results", "items"]) if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return null;
}

export function nextPageFromBody(data: unknown, currentPage: number): number | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (o.nextPage == null && o.next_page == null && o.hasMore !== true && o.has_more !== true) {
    if (typeof o.page === "number" && typeof o.totalPages === "number" && o.page < o.totalPages) return o.page + 1;
    return null;
  }
  const n = num(o.nextPage ?? o.next_page);
  if (n !== null && n > currentPage) return n;
  if (o.hasMore === true || o.has_more === true) return currentPage + 1;
  return null;
}

export function mapCompanyApiJob(raw: unknown, slug: string, opts: { companyPage?: string | null; source?: string } = {}): CompanyJobRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Record<string, unknown>;
  const title = pick(j, ["title"]);
  if (!title) return null;
  const id = pick(j, ["id", "externalJobId", "external_id"]);
  const modeRaw = (pick(j, ["workMode", "work_mode"]) ?? "unknown").toLowerCase();
  const posted = pick(j, ["postedAt", "posted_at", "postedDate"]);
  const postedOk = posted && !Number.isNaN(Date.parse(posted)) ? new Date(posted).toISOString() : null;
  const apply = applicationUrlOrNull(pick(j, ["applyUrl", "apply_url", "applicationUrl", "application_url"]), opts.companyPage ?? null, slug);
  const detail = applicationUrlOrNull(pick(j, ["url", "jobUrl", "job_url", "detailUrl"]), opts.companyPage ?? null, slug);
  return {
    externalJobId: id,
    title,
    normalizedTitle: pick(j, ["titleNormalized", "title_normalized", "normalizedTitle"]),
    seniority: pick(j, ["seniority"]),
    workMode: MODES.has(modeRaw) ? (modeRaw as CompanyJobRecord["workMode"]) : "unknown",
    employmentType: normalizeEmploymentType(pick(j, ["employmentType", "employment_type"])),
    location: pick(j, ["location"]),
    applicationUrl: apply,
    jobDetailUrl: detail,
    postedAt: postedOk,
    fresherFriendly: bool(j.fresherFriendly ?? j.fresher_friendly),
    experienceMin: num(j.expMin ?? j.experienceMin ?? j.experience_min),
    experienceMax: num(j.expMax ?? j.experienceMax ?? j.experience_max),
    salaryMin: num(j.salaryMinLpa ?? j.salaryMin ?? j.salary_min),
    salaryMax: num(j.salaryMaxLpa ?? j.salaryMax ?? j.salary_max),
    salaryEstimated: bool(j.salaryEstimated ?? j.salary_estimated),
    description: stripHtml(pick(j, ["summary", "description"]) ?? "").slice(0, 2500) || null,
    roleFamily: pick(j, ["roleFamily", "role_family"]),
    source: opts.source ?? "blrarena",
    companySlug: slug,
  };
}

export function mapCompanyApiJobs(body: unknown, slug: string, opts: { companyPage?: string | null; source?: string } = {}): { jobs: CompanyJobRecord[]; complete: boolean } | { error: string } {
  const arr = jobsArrayFromBody(body);
  if (!arr) return { error: "unexpected response shape" };
  const jobs = arr.map((j) => mapCompanyApiJob(j, slug, opts)).filter((j): j is CompanyJobRecord => !!j);
  return { jobs, complete: true };
}

/** Keep a previously stored valid application URL when a later payload omits it. */
export function mergeCompanyJob(existing: CompanyJobRecord, incoming: CompanyJobRecord): CompanyJobRecord {
  return {
    ...existing,
    ...incoming,
    applicationUrl: incoming.applicationUrl ?? existing.applicationUrl,
    jobDetailUrl: incoming.jobDetailUrl ?? existing.jobDetailUrl,
    externalJobId: incoming.externalJobId ?? existing.externalJobId,
    postedAt: incoming.postedAt ?? existing.postedAt,
    description: incoming.description ?? existing.description,
  };
}

export function jobDedupeKey(j: Pick<CompanyJobRecord, "companySlug" | "source" | "externalJobId" | "applicationUrl" | "title" | "location">): string {
  if (j.externalJobId) return `${j.companySlug}|${j.source}|id:${j.externalJobId}`;
  const apply = canonicalUrlSafe(j.applicationUrl);
  if (apply) return `${j.companySlug}|${j.source}|url:${apply}`;
  return `${j.companySlug}|${j.source}|role:${(j.title ?? "").toLowerCase()}|${(j.location ?? "").toLowerCase()}`;
}

function canonicalUrlSafe(u: string | null): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    x.hash = "";
    x.hostname = x.hostname.toLowerCase().replace(/^www\./, "");
    if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, "");
    return x.toString();
  } catch {
    return null;
  }
}

export function mergeJobLists(existing: CompanyJobRecord[], incoming: CompanyJobRecord[]): { merged: CompanyJobRecord[]; newCount: number; updatedCount: number } {
  const map = new Map<string, CompanyJobRecord>();
  for (const j of existing) map.set(jobDedupeKey(j), j);
  let newCount = 0;
  let updatedCount = 0;
  for (const j of incoming) {
    const k = jobDedupeKey(j);
    const prev = map.get(k);
    if (!prev) {
      // Same role from another source: merge onto the first copy, keep the best apply URL.
      const twin = [...map.values()].find((o) => o.companySlug === j.companySlug && o.source !== j.source && titlesMatch(o.title, j.title) && locationsMatch(o.location, j.location));
      if (twin) {
        const tk = jobDedupeKey(twin);
        map.set(tk, mergeCompatible(twin, j));
        updatedCount++;
        continue;
      }
      map.set(k, j);
      newCount++;
    } else {
      map.set(k, mergeCompanyJob(prev, j));
      updatedCount++;
    }
  }
  return { merged: [...map.values()], newCount, updatedCount };
}

function titlesMatch(a: string, b: string) {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return n(a) === n(b) && !!n(a);
}
function locationsMatch(a: string | null, b: string | null) {
  if (!a || !b) return false;
  return a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mergeCompatible(a: CompanyJobRecord, b: CompanyJobRecord): CompanyJobRecord {
  const prefer = rankSource(b.source) > rankSource(a.source) ? b : a;
  const other = prefer === a ? b : a;
  return {
    ...other,
    ...prefer,
    applicationUrl: prefer.applicationUrl ?? other.applicationUrl,
    jobDetailUrl: prefer.jobDetailUrl ?? other.jobDetailUrl,
    source: prefer.source,
    externalJobId: prefer.externalJobId ?? other.externalJobId,
  };
}

function rankSource(s: string): number {
  if (s.startsWith("ats:") || s === "greenhouse" || s === "lever" || s === "ashby" || s === "company_careers") return 3;
  if (s === "blrarena") return 2;
  return 1;
}

export function experienceLabel(j: Pick<CompanyJobRecord, "experienceMin" | "experienceMax" | "fresherFriendly">): string | null {
  if (j.experienceMin !== null) return `${j.experienceMin}${j.experienceMax !== null ? `-${j.experienceMax}` : "+"} years`;
  if (j.fresherFriendly === true) return "Fresher friendly";
  return null;
}

/** Raw records that carried an application URL which failed validation (unsafe, malformed, or just the company page). */
export function countInvalidApplyUrls(body: unknown, slug: string, companyPage: string | null): number {
  const arr = jobsArrayFromBody(body);
  if (!arr) return 0;
  let n = 0;
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const j = raw as Record<string, unknown>;
    const given = pick(j, ["applyUrl", "apply_url", "applicationUrl", "application_url"]);
    if (given && !applicationUrlOrNull(given, companyPage, slug)) n++;
  }
  return n;
}
