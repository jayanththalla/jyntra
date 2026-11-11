import { IngestError, type FetchOptions, type JobSource, type NormalizedJob, type ProviderFetchResult, type SourceValidationResult } from "../types";

export const SLUG = /^[A-Za-z0-9][A-Za-z0-9_.%-]{0,99}$/;
export const HOST_LABEL = /^[a-z0-9][a-z0-9-]{1,40}$/i;

/** Board identifiers go into URLs, so they are validated, never trusted. */
export function need(value: string | null | undefined, re: RegExp, what: string): string {
  if (!value || !re.test(value)) throw new IngestError(`invalid ${what}`, "client_error");
  return value;
}

export const arr = <T = Record<string, any>>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const rec = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
export const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

export function emptyResult(over: Partial<ProviderFetchResult> = {}): ProviderFetchResult {
  return { notModified: false, jobs: [], complete: true, httpStatus: 200, etag: null, lastModified: null, pages: 0, skipped: 0, ...over };
}

export function notModifiedResult(etag: string | null, lastModified: string | null): ProviderFetchResult {
  return emptyResult({ notModified: true, httpStatus: 304, etag, lastModified, complete: false, incompleteReason: "not modified" });
}

/** Validation = one lightweight fetch (first page only) and a check that real job data came back. */
export async function validateByFetching(
  fetchJobs: (src: JobSource, o?: FetchOptions) => Promise<ProviderFetchResult>,
  source: JobSource,
  requireNonEmpty = false,
): Promise<SourceValidationResult> {
  try {
    const r = await fetchJobs({ ...source, etag: null, lastModified: null }, { maxPages: 1 });
    const sample = r.jobs.slice(0, 3).map((j: NormalizedJob) => ({ title: j.title, location: j.locationText, applyUrl: j.applyUrl }));
    if (requireNonEmpty && r.jobs.length === 0) return { ok: false, httpStatus: r.httpStatus, jobCount: 0, sample, error: "board answered but listed no jobs", category: "not_found" };
    return { ok: true, httpStatus: r.httpStatus, jobCount: r.jobs.length, sample };
  } catch (e) {
    const ie = e instanceof IngestError ? e : null;
    return { ok: false, httpStatus: ie?.status ?? null, jobCount: null, sample: [], error: (e as Error).message.slice(0, 200), category: ie?.category ?? "network" };
  }
}

export function salary(min: unknown, max: unknown): { min: number | null; max: number | null } {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  return { min: n(min), max: n(max) };
}
