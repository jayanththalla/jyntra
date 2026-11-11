// Board validation against the REAL provider endpoint. Company discovery (is this a real employer board?) is kept apart from
// job discovery (what is open today?): this module answers the first question and reports what the board published at that moment.
import { query } from "@/lib/database";
import { getProvider, isProviderId } from "../providers";
import { IngestError, type IngestErrorCategory, type JobSource, type NormalizedJob } from "../types";

export type BoardValidationStatus =
  | "valid_with_jobs"
  | "valid_no_jobs"
  | "not_found"
  | "unsupported_provider"
  | "access_restricted"
  | "temporarily_unavailable"
  | "invalid_response";

export interface BoardValidation {
  status: BoardValidationStatus;
  httpStatus: number | null;
  jobsSeen: number;
  complete: boolean | null;
  /** Jobs whose OWN location is in India (a tracked city, India-remote, or another Indian city). */
  indiaJobs: number;
  cityCounts: Record<string, number>;
  sample: { title: string; location: string | null; applyUrl: string | null }[];
  error?: string;
  category?: IngestErrorCategory;
  /** The jobs themselves, for callers that go on to persist or report (never serialised into evidence). */
  jobs: NormalizedJob[];
}

/** A timeout, DNS failure, 5xx or 429 says nothing about whether the board exists, so it is never `not_found`. */
export function statusForError(category: IngestErrorCategory | undefined, httpStatus?: number | null): BoardValidationStatus {
  switch (category) {
    case "not_found": return "not_found";
    case "blocked": case "challenge": return "access_restricted";
    case "timeout": case "network": case "rate_limited": case "server_error": case "incomplete": return "temporarily_unavailable";
    case "client_error": return httpStatus === 404 || httpStatus === 410 ? "not_found" : "invalid_response";
    case "bad_response": case "invalid_json": case "too_large": case "unsafe_url": return "invalid_response";
    default: return httpStatus === 404 || httpStatus === 410 ? "not_found" : "temporarily_unavailable";
  }
}

export const isIndiaClass = (c: string) => c !== "unknown";

export function summarizeJobs(jobs: NormalizedJob[]): { cityCounts: Record<string, number>; indiaJobs: number } {
  const cityCounts: Record<string, number> = {};
  let indiaJobs = 0;
  for (const j of jobs) {
    cityCounts[j.cityClass] = (cityCounts[j.cityClass] ?? 0) + 1;
    for (const c of j.cities) cityCounts[`city:${c}`] = (cityCounts[`city:${c}`] ?? 0) + 1;
    if (isIndiaClass(j.cityClass)) indiaJobs++;
  }
  return { cityCounts, indiaJobs };
}

/** Fetches the board once (bounded pages) and classifies the outcome. Never throws. No database access. */
export async function validateBoard(source: JobSource, o: { maxPages?: number; signal?: AbortSignal } = {}): Promise<BoardValidation> {
  const empty = { httpStatus: null, jobsSeen: 0, complete: null, indiaJobs: 0, cityCounts: {}, sample: [], jobs: [] };
  if (!isProviderId(source.provider)) return { ...empty, status: "unsupported_provider", error: `no adapter for ${source.provider}` };
  try {
    const r = await getProvider(source.provider).fetchJobs(source, { maxPages: o.maxPages ?? 3, signal: o.signal });
    const { cityCounts, indiaJobs } = summarizeJobs(r.jobs);
    return {
      status: r.jobs.length > 0 ? "valid_with_jobs" : "valid_no_jobs", httpStatus: r.httpStatus, jobsSeen: r.jobs.length, complete: r.complete, indiaJobs, cityCounts,
      sample: r.jobs.slice(0, 3).map((j) => ({ title: j.title, location: j.locationText, applyUrl: j.applyUrl })), jobs: r.jobs,
    };
  } catch (e) {
    const ie = e instanceof IngestError ? e : null;
    return { ...empty, status: statusForError(ie?.category ?? "network", ie?.status), httpStatus: ie?.status ?? null, error: (e as Error).message.slice(0, 200), category: ie?.category ?? "network" };
  }
}

export const boardRef = (s: Pick<JobSource, "boardSlug" | "tenant" | "host" | "careerSite">) => [s.boardSlug, s.tenant, s.host, s.careerSite].filter(Boolean).join("/");

export async function recordValidation(r: { candidateId?: number | null; sourceId?: number | null; provider: string; source: Pick<JobSource, "boardSlug" | "tenant" | "host" | "careerSite">; v: BoardValidation }) {
  await query(
    `INSERT INTO source_validations (candidate_id, source_id, provider, board_ref, status, http_status, jobs_seen, complete, india_jobs, city_counts, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [r.candidateId ?? null, r.sourceId ?? null, r.provider, boardRef(r.source).slice(0, 300), r.v.status, r.v.httpStatus, r.v.jobsSeen, r.v.complete, r.v.indiaJobs, JSON.stringify(r.v.cityCounts), r.v.error ?? null],
  );
}
