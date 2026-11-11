// Per-source health, stored in the `sources` table. Two audiences:
//  - users get ONE short sentence per source that needs attention (userMessage), never a raw error;
//  - the technical section gets provider, error category, retry time and last-successful time (technicalRows).
// Neither ever contains a key, a URL with a query string or a response body.
import { query } from "@/lib/database";
import { disabledByConfig } from "@/lib/providers/config";
import { settings } from "@/config/settings";

export interface SourceHealth {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_error_category: string | null;
  next_retry_at: string | null;
  consecutive_failures: number;
  last_duration_ms: number | null;
}

/** Records the outcome of one refresh of one source. `error` text is kept short and is never a credential. */
export async function recordSourceRun(
  id: string,
  r: { ok: boolean; note?: string; error?: string; category?: string; retryAfterSeconds?: number; durationMs: number }
) {
  const err = r.error ? redact(r.error).slice(0, 300) : null;
  const waitMs = Math.max((r.retryAfterSeconds ?? 0) * 1000, settings.live.retryAfterFailureMinutes * 60_000);
  await query(
    `UPDATE sources SET last_run_at = now(), last_duration_ms = $5,
       last_status = $2,
       last_success_at = CASE WHEN $3 THEN now() ELSE last_success_at END,
       consecutive_failures = CASE WHEN $3 THEN 0 ELSE consecutive_failures + 1 END,
       last_error = $4,
       last_error_category = $6,
       next_retry_at = CASE WHEN $3 THEN NULL ELSE now() + ($7::int * interval '1 millisecond') END
     WHERE id = $1`,
    [id, r.ok ? `ok${r.note ? `: ${r.note}` : ""}` : `error: ${err}`, r.ok, r.ok ? null : err, Math.round(r.durationMs), r.ok ? null : r.category ?? "network", waitMs]
  );
}

/** Removes anything that looks like a credential or a query string from text that will be stored or shown. */
export function redact(text: string): string {
  return text
    .replace(/([?&](?:api[_-]?key|key|token|secret|password|api-subscription-key)=)[^&\s"']+/gi, "$1…")
    .replace(/\b(key|token|secret|password)=[^&\s]+/gi, "$1=…")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1…")
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, "$1");
}

export async function listSourceHealth(): Promise<SourceHealth[]> {
  return query<SourceHealth>(
    `SELECT id, name, kind, enabled, last_run_at, last_success_at, last_status, last_error, last_error_category, next_retry_at,
            consecutive_failures, last_duration_ms
     FROM sources ORDER BY kind, id`
  );
}

/** A source is "stale" when its last success is older than this. */
export const STALE_AFTER_HOURS = 36;

export type SourceState = "ok" | "stale" | "failing" | "never_run" | "not_configured" | "disabled";

/** Optional providers are "not configured" (not "failing") when their key is absent. */
const needsKey: Record<string, (env: Record<string, string | undefined>) => boolean> = {
  tavily: (e) => !e.TAVILY_API_KEY,
  google_cse: (e) => !(e.GOOGLE_SEARCH_API_KEY && e.GOOGLE_SEARCH_CX),
  search: (e) => !e.SEARCH_API_KEY,
};

export function classifySource(s: SourceHealth, now = Date.now(), env: Record<string, string | undefined> = process.env): SourceState {
  if (!s.enabled || disabledByConfig(s.id, env)) return "disabled";
  const ageHours = s.last_success_at ? (now - new Date(s.last_success_at).getTime()) / 3_600_000 : null;
  const skipped = (s.last_status ?? "").startsWith("skipped") || (needsKey[s.id]?.(env) ?? false);
  if (skipped) return "not_configured";
  if (s.last_run_at === null) return "never_run";
  if (s.consecutive_failures > 0) return "failing";
  if (ageHours !== null && ageHours > STALE_AFTER_HOURS) return "stale";
  return "ok";
}

/** Short names for the UI; the full descriptive name stays in diagnostics. */
const SHORT_NAME: Record<string, string> = {
  funding_rss: "Funding news",
  funding_connectors: "Funding connectors",
  himalayas: "Himalayas",
  yc: "YC directory",
  startupmaps: "Hyderabad dataset",
  company_careers: "Company career pages",
  oss_github: "Open source",
  tavily: "Tavily news",
  google_cse: "Google search",
  gdelt: "GDELT news",
  search: "Web search",
  fx_frankfurter: "Exchange rates",
};
export const shortName = (id: string, fallback: string) => SHORT_NAME[id] ?? fallback;

/** One concise, calm sentence for a source that needs attention. Never exposes provider internals. */
export function userMessage(id: string, name: string, state: SourceState, category: string | null, lastSuccess: string | null, now = Date.now()): string | null {
  const n = shortName(id, name);
  const since = lastSuccess ? ` Showing data from ${agoText(lastSuccess, now)}.` : "";
  switch (state) {
    case "failing":
      return category === "rate_limited" ? `${n} is busy right now and will be retried shortly.${since}` : `${n} could not be updated.${since}`;
    case "stale":
      return `${n} has not updated recently.${since}`;
    case "never_run":
      return `${n} has not been checked yet.`;
    default:
      return null;
  }
}

export function agoText(iso: string, now = Date.now()): string {
  const m = Math.max(0, (now - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  return h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
}

export async function describeSources(now = Date.now()) {
  const rows = await listSourceHealth();
  const sources = rows.map((s) => {
    const state = classifySource(s, now);
    return {
      id: s.id,
      name: shortName(s.id, s.name),
      kind: s.kind,
      state,
      last_success_at: s.last_success_at,
      last_run_at: s.last_run_at,
      consecutive_failures: s.consecutive_failures,
      message: userMessage(s.id, s.name, state, s.last_error_category, s.last_success_at, now),
    };
  });
  // Detailed diagnostics are a separate list: provider, error category, retry time, last success. No raw error text.
  const technical = rows.map((s) => ({
    provider: s.id,
    description: s.name,
    state: classifySource(s, now),
    error_category: s.consecutive_failures > 0 ? s.last_error_category : null,
    consecutive_failures: s.consecutive_failures,
    next_retry_at: s.consecutive_failures > 0 ? s.next_retry_at : null,
    last_run_at: s.last_run_at,
    last_success_at: s.last_success_at,
    disabled_reason: disabledByConfig(s.id),
  }));
  let company_jobs = null as Awaited<ReturnType<typeof import("@/lib/company-jobs/sync").companyJobDiagnostics>> | null;
  try {
    company_jobs = await (await import("@/lib/company-jobs/sync")).companyJobDiagnostics();
  } catch {
    company_jobs = null;
  }
  return {
    sources,
    technical,
    company_jobs,
    stale_after_hours: STALE_AFTER_HOURS,
    attention: sources.filter((s) => ["failing", "stale", "never_run"].includes(s.state)).map((s) => s.id),
  };
}
