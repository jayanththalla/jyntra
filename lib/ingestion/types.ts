// Shared types for the background job-ingestion engine. Nothing here talks to the network or the database.

export type ProviderId =
  | "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workable" | "recruitee"
  | "workday" | "personio" | "breezy" | "keka" | "darwinbox" | "oracle" | "eightfold";

/** Where a board lives. Which fields matter depends on the provider (see providers/index.ts → meta.resolution). */
export interface JobSource {
  id: number | null;
  companySlug: string;
  provider: ProviderId;
  boardSlug: string | null; // greenhouse/lever/ashby/smartrecruiters/workable/recruitee/personio/breezy/keka/darwinbox (tenant subdomain)
  tenant: string | null; // workday tenant
  host: string | null; // workday cluster, e.g. "wd3"
  careerSite: string | null; // workday site / darwinbox companyId / keka portal
  sourceUrl: string | null;
  etag: string | null;
  lastModified: string | null;
  /** Free-form, provider-specific options (e.g. workday searchTerms). Validated by the provider. */
  config: Record<string, unknown>;
}

export type WorkplaceType = "onsite" | "hybrid" | "remote" | "unknown";

/** City bucket of ONE job, from the job's own location text (never from the company's office). */
export type CityClass = "bengaluru" | "hyderabad" | "chennai" | "both" | "multi" | "india_remote" | "other_india" | "unknown";

/** The cities Jyntra tracks individually. A job can list several (`cities`); `cityClass` is the single-bucket summary. */
export type TrackedCity = "bengaluru" | "hyderabad" | "chennai";
export type SupportedCity = TrackedCity | "india_remote" | "other" | "unknown";

export type LicenseClass = "employer_public" | "aggregator_restricted";

export interface NormalizedJob {
  externalJobId: string;
  companySlug: string;
  title: string;
  description: string | null;
  locationText: string | null;
  locations: string[];
  cityClass: CityClass;
  /** Every tracked city this job is actually located in (from the job's own locations, never the company's offices). */
  cities: TrackedCity[];
  /** Remote AND open to candidates in India (explicit in the source). Separate from cityClass so city filters stay honest. */
  remoteIndia: boolean;
  workplaceType: WorkplaceType;
  employmentType: string | null;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  /** Only the date the source states. Never `updated_at`, never "now". */
  postedAt: string | null;
  /** Original application destination. null when the source gave none that passed validation. Never invented. */
  applyUrl: string | null;
  sourceUrl: string;
  provider: ProviderId;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface FetchOptions {
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  /** Hard cap on pages for paginated providers; hitting it makes the result incomplete. */
  maxPages?: number;
  signal?: AbortSignal;
}

export interface ProviderFetchResult {
  /** 304: nothing was parsed; the previous job set stands. */
  notModified: boolean;
  jobs: NormalizedJob[];
  /** True only when every page/segment was read and parsed. Closure of missing jobs requires this. */
  complete: boolean;
  incompleteReason?: string;
  httpStatus: number;
  etag: string | null;
  lastModified: string | null;
  pages: number;
  /** Records the provider returned that could not be turned into a job (no id/title). */
  skipped: number;
}

export interface SourceValidationResult {
  ok: boolean;
  httpStatus: number | null;
  jobCount: number | null;
  /** Up to 3 sample titles with locations: validation evidence. */
  sample: { title: string; location: string | null; applyUrl: string | null }[];
  error?: string;
  category?: IngestErrorCategory;
}

export interface JobProvider {
  provider: ProviderId;
  validateSource(source: JobSource): Promise<SourceValidationResult>;
  fetchJobs(source: JobSource, options?: FetchOptions): Promise<ProviderFetchResult>;
}

export type IngestErrorCategory =
  | "timeout" | "rate_limited" | "server_error" | "client_error" | "blocked" | "challenge"
  | "network" | "bad_response" | "invalid_json" | "too_large" | "unsafe_url" | "not_found" | "incomplete";

export class IngestError extends Error {
  constructor(
    message: string,
    public category: IngestErrorCategory,
    public status?: number,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

/** Documentation each provider must carry (spec §5). Rendered in docs/PROVIDERS.md and the admin page. */
export interface ProviderMeta {
  provider: ProviderId;
  label: string;
  endpoint: string;
  documented: boolean; // true = vendor-documented public API; false = public career-widget endpoint
  auth: string;
  resolution: string; // how the board is resolved from a careers URL
  fields: string;
  pagination: string;
  rateLimit: string;
  limitations: string;
  /** Honest status: what has actually been run. */
  verification: string;
}
