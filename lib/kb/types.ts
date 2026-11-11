// Shared contracts for the career knowledge base.
export type Provider = "github" | "upload" | "codeforces" | "leetcode" | "linkedin" | "portfolio" | "notes" | "gdocs";
export type DocType = "readme" | "code" | "manifest" | "doc" | "issue" | "pull_request" | "commits" | "profile" | "resume" | "note" | "coding_stats";
export type EvidenceLevel = "demonstrated" | "self_reported" | "inferred" | "unverified";
export type SourceStatus = "pending" | "connected" | "syncing" | "error" | "disconnected" | "revoked";

/** One record a connector produced, before it is stored. Everything here is untrusted data. */
export interface RawDoc {
  externalId: string; // stable id within the source, e.g. "owner/repo:README.md"
  docType: DocType;
  title: string;
  url?: string | null; // only http(s) URLs are stored
  content: string;
  project?: string | null;
  modifiedAt?: string | null; // source's own timestamp
  metadata?: Record<string, unknown>; // e.g. { technologies: ["Next.js"], language: "TypeScript" }
}

export interface SyncContext {
  userId: number;
  sourceId: number;
  config: Record<string, any>;
  /** Decrypted credential, if the source has one. Never log it. */
  token?: string | null;
  fetchImpl: typeof fetch;
  /** Returns true when the user cancelled; connectors check between units of work. */
  cancelled: () => boolean;
  log: (m: string) => void;
  limits: { maxRepos: number; maxFilesPerRepo: number; maxFileBytes: number; maxDocs: number };
}

export interface SyncResult {
  docs: RawDoc[];
  /** True only if the listing is complete, so documents missing from it can be treated as deleted at the source. */
  complete: boolean;
  /** Non-fatal problems (rate limit hit midway, one repo inaccessible...). */
  warnings: string[];
}

export interface Connector {
  provider: Provider;
  /**
   * Optional, cheap (one request) check for "has the provider changed since `sinceIso`?". Returns the newest change time it could see,
   * or null when it can't tell. It never reads content and never replaces a sync: it only lets us notice that the index is behind.
   */
  probe?(ctx: Pick<SyncContext, "config" | "token" | "fetchImpl">): Promise<{ latestChangeAt: string | null }>;
  /** Fetch and normalise. Must throw SourceError for auth/permission problems. */
  sync(ctx: SyncContext): Promise<SyncResult>;
}

export type SourceErrorCode = "unauthorized" | "revoked" | "rate_limited" | "not_found" | "unavailable" | "invalid";
export class SourceError extends Error {
  constructor(public code: SourceErrorCode, message: string, public retryAfterMs?: number) {
    super(message);
  }
}

export const DEFAULT_LIMITS: SyncContext["limits"] = { maxRepos: 20, maxFilesPerRepo: 40, maxFileBytes: 100_000, maxDocs: 800 };
