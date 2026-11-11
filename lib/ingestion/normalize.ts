// Turns whatever a provider returned into a NormalizedJob. All providers go through finalizeJob so rules (apply-URL
// validation, city class, hashing, date sanity) exist once.
import crypto from "node:crypto";
import { stripHtml } from "@/lib/text";
import { normalizeEmploymentType } from "@/lib/normalize";
import { validateApplicationUrl } from "@/lib/company-jobs/urls";
import { CLASSIFIER_VERSION, classifyLocation, splitLocations, workplaceFromText } from "./location";
import type { NormalizedJob, ProviderId, WorkplaceType } from "./types";

const MAX_DESCRIPTION = 20_000;

/** ISO timestamp from the shapes ATSs send (ISO, "2026-08-19 13:16:05 UTC", epoch s/ms). null when absent, unparsable, pre-2000 or in the future. */
export function toIso(v: unknown, now = Date.now()): string | null {
  if (v === null || v === undefined || v === "") return null;
  let ms: number;
  if (typeof v === "number") ms = v < 1e11 ? v * 1000 : v;
  else if (typeof v === "string") {
    const s = v.trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, "$1T$2Z");
    ms = /^\d{10,13}$/.test(s) ? (s.length <= 10 ? Number(s) * 1000 : Number(s)) : Date.parse(s);
  } else return null;
  if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1) || ms > now + 2 * 86_400_000) return null;
  return new Date(ms).toISOString();
}

/** Years of experience stated in free text. Conservative: only explicit "N-M years" / "N+ years" / "at least N years". */
export function parseExperience(text: string | null | undefined): { min: number | null; max: number | null } {
  const t = (text ?? "").replace(/\s+/g, " ");
  if (!t) return { min: null, max: null };
  let m = t.match(/\b(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a <= b && b <= 40) return { min: a, max: b };
  }
  m = t.match(/\b(?:at least|minimum(?: of)?|min\.?|over)\s+(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i) ?? t.match(/\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i);
  if (m && Number(m[1]) <= 40) return { min: Number(m[1]), max: null };
  return { min: null, max: null };
}

export function contentHashOf(j: Pick<NormalizedJob, "cityClass" | "cities" | "remoteIndia" | "title" | "description" | "locationText" | "locations" | "workplaceType" | "employmentType" | "experienceMin" | "experienceMax" | "salaryMin" | "salaryMax" | "salaryCurrency" | "applyUrl" | "postedAt">): string {
  const payload = JSON.stringify([
    j.title, j.description, j.locationText, [...j.locations].sort(), j.workplaceType, j.employmentType,
    j.experienceMin, j.experienceMax, j.salaryMin, j.salaryMax, j.salaryCurrency, j.applyUrl, j.postedAt,
    // Classification is derived data: it is hashed (with the rule version) so a rule change re-classifies stored rows on the next sync.
    j.cityClass, [...j.cities].sort(), j.remoteIndia, CLASSIFIER_VERSION,
  ]);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export interface RawJobInput {
  externalJobId: unknown;
  title: unknown;
  descriptionHtml?: string | null;
  descriptionText?: string | null;
  locationTexts?: (string | null | undefined)[];
  workplaceType?: WorkplaceType;
  /** Provider-confirmed remote flag (e.g. Ashby isRemote). true upgrades unknown → remote. */
  remoteFlag?: boolean | null;
  employmentType?: string | null;
  experienceMin?: number | null;
  experienceMax?: number | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
  postedAt?: unknown;
  applyUrl?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "").trim();
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** null when the record has no usable id or title (the caller counts it as skipped). */
export function finalizeJob(companySlug: string, provider: ProviderId, boardUrl: string, r: RawJobInput): NormalizedJob | null {
  const externalJobId = str(r.externalJobId);
  const title = str(r.title).replace(/\s+/g, " ");
  if (!externalJobId || !title) return null;
  const description = (r.descriptionText ?? (r.descriptionHtml ? stripHtml(decodeEntitiesTwice(r.descriptionHtml)) : "")).trim().slice(0, MAX_DESCRIPTION) || null;
  const locations = splitLocations(r.locationTexts ?? []);
  const locationText = locations.length ? locations.join(" / ") : null;
  let workplace: WorkplaceType = r.workplaceType ?? "unknown";
  if (workplace === "unknown") workplace = workplaceFromText(locationText, r.remoteFlag ? "remote" : null);
  const cls = classifyLocation(locations, workplace);
  const exp = r.experienceMin != null || r.experienceMax != null ? { min: numOrNull(r.experienceMin), max: numOrNull(r.experienceMax) } : parseExperience(`${title} ${description ?? ""}`.slice(0, 6000));
  const applyUrl = validateApplicationUrl(r.applyUrl ?? null);
  const sourceUrl = validateApplicationUrl(r.sourceUrl ?? null) ?? applyUrl ?? boardUrl;
  const job: NormalizedJob = {
    externalJobId, companySlug, title, description, locationText, locations,
    cityClass: cls.cityClass, cities: cls.cities, remoteIndia: cls.remoteIndia, workplaceType: workplace,
    employmentType: normalizeEmploymentType(r.employmentType ?? (/\bintern(ship)?\b/i.test(title) ? "Internship" : null)),
    experienceMin: exp.min, experienceMax: exp.max,
    salaryMin: numOrNull(r.salaryMin), salaryMax: numOrNull(r.salaryMax), salaryCurrency: r.salaryCurrency ?? null, salaryPeriod: r.salaryPeriod ?? null,
    postedAt: toIso(r.postedAt),
    applyUrl, sourceUrl, provider, contentHash: "", metadata: r.metadata ?? {},
  };
  job.contentHash = contentHashOf(job);
  return job;
}

/** Greenhouse double-escapes its HTML (&lt;p&gt;). Decode one level so stripHtml sees real tags. */
function decodeEntitiesTwice(s: string): string {
  return /&lt;\s*\/?[a-z]/i.test(s) ? s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"') : s;
}
