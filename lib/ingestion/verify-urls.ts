// Live verification of the employer's application link. It only RECORDS a result; it never edits application_url and never
// closes a job (closure is decided solely by a complete source fetch).
import { query } from "@/lib/database";
import { httpRequest } from "./http";
import { KeyedLimiter } from "./limiter";
import { IngestError } from "./types";

export type ApplyUrlStatus = "ok" | "gone" | "restricted" | "unreachable" | "unsafe";

/** Pure: maps a probe outcome to a status. 401/403/429/challenge mean "could not verify" (restricted), not "broken". */
export function applyUrlStatusFor(e: { status?: number; category?: string } | null, okStatus?: number): ApplyUrlStatus {
  if (!e) return okStatus && okStatus >= 200 && okStatus < 400 ? "ok" : "unreachable";
  if (e.category === "too_large") return "ok"; // a 2xx body bigger than our probe cap still proves the page exists
  if (e.status === 404 || e.status === 410) return "gone";
  if (e.category === "unsafe_url") return "unsafe";
  if (e.category === "blocked" || e.category === "challenge" || e.category === "rate_limited" || e.status === 401 || e.status === 403 || e.status === 429) return "restricted";
  return "unreachable";
}

export async function probeUrl(url: string, o: { signal?: AbortSignal } = {}): Promise<{ status: ApplyUrlStatus; http: number | null }> {
  const attempt = async (method: "HEAD" | "GET") => {
    try {
      const r = await httpRequest(url, { method, headers: method === "GET" ? { Range: "bytes=0-2047", Accept: "text/html,*/*" } : { Accept: "text/html,*/*" }, timeoutMs: 15_000, maxBytes: 4096, signal: o.signal });
      return { status: applyUrlStatusFor(null, r.status), http: r.status };
    } catch (e) {
      const ie = e instanceof IngestError ? e : new IngestError((e as Error).message, "network");
      return { status: applyUrlStatusFor(ie), http: ie.status ?? null, retryWithGet: method === "HEAD" && [403, 405, 501, 400].includes(ie.status ?? 0) };
    }
  };
  const first = await attempt("HEAD");
  if ((first as { retryWithGet?: boolean }).retryWithGet) { const g = await attempt("GET"); return { status: g.status, http: g.http }; }
  return { status: first.status, http: first.http };
}

export interface VerifyReport { checked: number; byStatus: Record<string, number>; durationMs: number }

/** Checks active jobs' apply links that were never checked or are older than `maxAgeHours`. */
export async function verifyApplyUrls(o: { limit?: number; city?: string | null; maxAgeHours?: number; concurrency?: number; signal?: AbortSignal } = {}): Promise<VerifyReport> {
  const t0 = Date.now();
  const rows = await query<{ id: number; application_url: string }>(
    `SELECT id, application_url FROM company_jobs
     WHERE is_active AND source_id IS NOT NULL AND application_url IS NOT NULL
       AND (apply_url_checked_at IS NULL OR apply_url_checked_at < now() - make_interval(hours => $2::int))
       AND ($3::text IS NULL OR ($3 = 'india_remote' AND city_class='india_remote') OR $3 = ANY(cities))
     ORDER BY apply_url_checked_at NULLS FIRST, id LIMIT $1`,
    [o.limit ?? 200, o.maxAgeHours ?? 24 * 7, o.city && o.city !== "all" ? o.city : null]);
  const byStatus: Record<string, number> = {};
  const global = new KeyedLimiter(o.concurrency ?? 4);
  const perHost = new KeyedLimiter(1);
  await Promise.all(rows.map((r) => {
    let host = "x";
    try { host = new URL(r.application_url).hostname; } catch { /* probeUrl reports unsafe */ }
    return global.run(["all"], () => perHost.run([`h:${host}`], async () => {
      if (o.signal?.aborted) return;
      const p = await probeUrl(r.application_url, { signal: o.signal });
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      await query("UPDATE company_jobs SET apply_url_status=$2, apply_url_http=$3, apply_url_checked_at=now() WHERE id=$1", [r.id, p.status, p.http]);
    }));
  }));
  return { checked: rows.length, byStatus, durationMs: Date.now() - t0 };
}
