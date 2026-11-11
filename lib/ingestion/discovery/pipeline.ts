// Walks candidates through the state machine. A candidate becomes an ACTIVE SOURCE only when its real board endpoint
// answered with valid job data AND at least one job is in Bengaluru, Hyderabad or open to India-remote.
import { query } from "@/lib/database";
import { detectAts, toSource } from "../providers/detect";
import { atsBoardUrlFor } from "../board-url";
import { ensureCompany, upsertSource } from "../source-store";
import type { CityClass } from "../types";
import { recordValidation, validateBoard } from "./validation";
import { getCandidate, setCandidate, dueCandidates, type CandidateRow } from "./candidates";
import { resolveCareers } from "./website";
import { KeyedLimiter } from "../limiter";
import { hostKeyOf, hostLimitKeys, PROVIDER_LIMITS } from "../scheduler";

const TARGET: CityClass[] = ["bengaluru", "hyderabad", "chennai", "both", "multi", "india_remote"];
const RETRY_DAYS = [1, 3, 7, 14, 30];
const DNS_STRIKES = 4;
export const dailyDiscoveryLimit = () => { const n = Number(process.env.JOB_DISCOVERY_DAILY_LIMIT); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1500; };

export type StepResult = { id: number; state: string; note?: string; activated?: boolean; notRelevant?: boolean; validated?: boolean; failed?: boolean };

export async function processCandidate(id: number): Promise<StepResult> {
  const c = await getCandidate(id);
  if (!c) return { id, state: "missing" };
  const attempts = c.attempts + 1;
  try {
    if (c.state === "candidate_discovered") {
      await setCandidate(id, "needs_manual_review", { error: "no website or board to resolve; an admin can enter the official careers URL", attempts });
      return { id, state: "needs_manual_review" };
    }
    if (c.state === "website_identified" || c.state === "career_page_identified") {
      const direct = c.careers_url ? detectAts(c.careers_url) : null;
      const res = direct ? { ats: direct, careersUrl: c.careers_url, pagesChecked: [], foundIn: c.careers_url } : await resolveCareers((c.state === "website_identified" ? c.website_url : c.careers_url) ?? c.website_url ?? "");
      if (res.ats) {
        await setCandidate(id, "ats_detected", { evidence: { careers: { url: res.careersUrl, foundIn: res.foundIn, pagesChecked: res.pagesChecked } }, provider: res.ats.provider, boardSlug: res.ats.boardSlug, tenant: res.ats.tenant, host: res.ats.host, careerSite: res.ats.careerSite, careersUrl: res.careersUrl, attempts });
        return processCandidate(id);
      }
      if (res.careersUrl && c.state === "website_identified") {
        await setCandidate(id, "career_page_identified", { careersUrl: res.careersUrl, evidence: { careers: { url: res.careersUrl, pagesChecked: res.pagesChecked } }, attempts });
        return { id, state: "career_page_identified", note: res.note };
      }
      await setCandidate(id, "needs_manual_review", { error: res.note ?? "no supported ATS found", evidence: { pagesChecked: res.pagesChecked }, attempts });
      return { id, state: "needs_manual_review", note: res.note };
    }
    return await validate(c, attempts);
  } catch (e) {
    const wait = RETRY_DAYS[Math.min(attempts - 1, RETRY_DAYS.length - 1)]! * 86400;
    await setCandidate(id, attempts >= 5 ? "needs_manual_review" : "failed_source", { error: (e as Error).message.slice(0, 300), attempts, nextAttemptInSeconds: wait });
    return { id, state: attempts >= 5 ? "needs_manual_review" : "failed_source", failed: true, note: (e as Error).message };
  }
}

async function validate(c: CandidateRow, attempts: number): Promise<StepResult> {
  if (!c.provider) throw new Error("no provider to validate");
  const probe = toSource("pending", { provider: c.provider, boardSlug: c.board_slug, tenant: c.tenant, host: c.host, careerSite: c.career_site, sourceUrl: c.careers_url ?? "" });
  const v = await validateBoard(probe, { maxPages: 3 });
  const at = new Date().toISOString();
  const evidenceBase = { status: v.status, at, httpStatus: v.httpStatus, category: v.category ?? null };
  if (v.status === "unsupported_provider") {
    await recordValidation({ candidateId: c.id, provider: c.provider, source: probe, v });
    await setCandidate(c.id, "needs_manual_review", { error: v.error ?? "unsupported provider", attempts, evidence: { lastValidation: { ok: false, ...evidenceBase } } });
    return { id: c.id, state: "needs_manual_review", failed: true, note: v.error };
  }
  if (v.status !== "valid_with_jobs" && v.status !== "valid_no_jobs") {
    await recordValidation({ candidateId: c.id, provider: c.provider, source: probe, v });
    // Transient problems (our network, their outage, rate limits, bot protection) say nothing about the board: retry later, don't burn an attempt.
    if (v.status === "temporarily_unavailable" || v.status === "access_restricted") {
      // A single DNS miss proves nothing. Only after DNS_STRIKES misses on separate checks (≥6 h apart) is a tenant host treated as gone.
      const dns = v.error?.startsWith("DNS:") === true;
      const prevStrikes = Number((c.evidence as any)?.lastValidation?.dnsStrikes ?? 0);
      const strikes = dns ? prevStrikes + 1 : 0;
      if (dns && strikes >= DNS_STRIKES) {
        await setCandidate(c.id, "failed_source", { error: `host never resolved in ${strikes} checks`, attempts: c.attempts, nextAttemptInSeconds: 7 * 86400, evidence: { lastValidation: { ok: false, dead: true, dnsStrikes: strikes, ...evidenceBase, status: "not_found" } } });
        await query("UPDATE source_validations SET status='not_found' WHERE id = (SELECT max(id) FROM source_validations WHERE candidate_id=$1)", [c.id]);
        return { id: c.id, state: "failed_source", failed: true, note: "host never resolved" };
      }
      const wait = v.category === "rate_limited" ? 6 * 3600 : v.status === "access_restricted" ? 24 * 3600 : 6 * 3600;
      await setCandidate(c.id, "failed_source", { error: `${v.category}: ${v.error}`.slice(0, 300), attempts: c.attempts, nextAttemptInSeconds: wait, evidence: { lastValidation: { ok: false, transient: true, dnsStrikes: strikes, ...evidenceBase } } });
      return { id: c.id, state: "failed_source", failed: true, note: v.error };
    }
    const wait = RETRY_DAYS[Math.min(attempts - 1, RETRY_DAYS.length - 1)]! * 86400;
    await setCandidate(c.id, attempts >= 5 ? "needs_manual_review" : "failed_source", { error: `${v.category ?? "error"}: ${v.error}`.slice(0, 300), attempts, nextAttemptInSeconds: wait, evidence: { lastValidation: { ok: false, dead: v.status === "not_found", ...evidenceBase } } });
    return { id: c.id, state: attempts >= 5 ? "needs_manual_review" : "failed_source", failed: true, note: v.error };
  }
  const evidence = { lastValidation: { ok: true, ...evidenceBase, jobsSeen: v.jobsSeen, complete: v.complete, byCity: v.cityCounts, indiaJobs: v.indiaJobs, sample: v.sample } };
  const trackedNow = v.jobs.filter((j) => TARGET.includes(j.cityClass)).length;
  if (v.indiaJobs === 0) {
    // The board is real but publishes no India jobs right now. Keep it as validated-not-active and look again later.
    await recordValidation({ candidateId: c.id, provider: c.provider, source: probe, v });
    await setCandidate(c.id, "board_validated", { evidence: { ...evidence, relevance: v.jobsSeen === 0 ? "no_jobs" : "no_india_jobs" }, attempts, nextAttemptInSeconds: 14 * 86400 });
    return { id: c.id, state: "board_validated", validated: true, notRelevant: true };
  }
  // India-relevant board: register it as a source even if it has no job in a particular tracked city today. It may publish one next week.
  const careersUrl = atsBoardUrlFor({ provider: c.provider, boardSlug: c.board_slug, tenant: c.tenant, host: c.host, careerSite: c.career_site });
  const slug = await ensureCompany(c.name, { careersUrl, website: c.website_url });
  const sourceId = await upsertSource({ ...probe, companySlug: slug, sourceUrl: careersUrl, validation: { ...evidence.lastValidation, relevantJobs: v.indiaJobs, trackedCityJobs: trackedNow } });
  await recordValidation({ candidateId: c.id, sourceId, provider: c.provider, source: probe, v });
  await setCandidate(c.id, "active_source", { evidence: { ...evidence, relevance: trackedNow > 0 ? "tracked_city_jobs" : "india_jobs_other_cities", relevantJobs: v.indiaJobs, trackedCityJobs: trackedNow }, attempts, companySlug: slug, sourceId, nextAttemptInSeconds: 365 * 86400 });
  return { id: c.id, state: "active_source", validated: true, activated: true };
}

export interface QueueSummary { processed: number; activated: number; validated: number; notRelevant: number; failed: number; manualReview: number; capped: boolean; byState: Record<string, number> }

const num = (v: string | undefined, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo ? Math.min(hi, Math.floor(n)) : d; };
export const discoveryConcurrency = () => num(process.env.JOB_DISCOVERY_CONCURRENCY, 4, 1, 20);
export const discoveryBatchSize = () => num(process.env.JOB_DISCOVERY_BATCH, 200, 1, 5000);

/** One bounded batch. Honours JOB_DISCOVERY_DAILY_LIMIT (validation fetches per UTC day) unless `ignoreDailyLimit` (operator-run seeding),
 *  validates candidates concurrently under per-provider and per-host limits, and records a source_discovery_runs row. */
export async function processQueue(o: { limit?: number; signal?: AbortSignal; ignoreDailyLimit?: boolean; concurrency?: number; method?: string; provider?: string | null } = {}): Promise<QueueSummary> {
  const [{ used }] = await query<{ used: string }>("SELECT COALESCE(sum(candidates_seen),0)::text used FROM source_discovery_runs WHERE method='validate_queue' AND started_at >= date_trunc('day', now())");
  const remaining = o.ignoreDailyLimit ? Number.MAX_SAFE_INTEGER : Math.max(0, dailyDiscoveryLimit() - Number(used));
  const limit = Math.min(o.limit ?? 25, remaining);
  const sum: QueueSummary = { processed: 0, activated: 0, validated: 0, notRelevant: 0, failed: 0, manualReview: 0, capped: remaining === 0, byState: {} };
  if (limit === 0) return sum;
  const [run] = await query<{ id: number }>("INSERT INTO source_discovery_runs (method) VALUES ($1) RETURNING id", [o.method ?? "validate_queue"]);
  const global = new KeyedLimiter(o.concurrency ?? discoveryConcurrency());
  const byProvider = new KeyedLimiter(3, PROVIDER_LIMITS);
  const byHost = new KeyedLimiter(1);
  const due = await dueCandidates(limit, o.provider);
  await Promise.all(due.map((c) => global.run(["all"], () => byProvider.run([`p:${c.provider ?? "none"}`], () => byHost.run(c.provider ? hostLimitKeys(c.provider, hostKeyOf({ provider: c.provider, board_slug: c.board_slug, tenant: c.tenant, host: c.host })) : [], async () => {
    if (o.signal?.aborted) return;
    const r = await processCandidate(c.id);
    sum.processed++;
    sum.byState[r.state] = (sum.byState[r.state] ?? 0) + 1;
    if (r.activated) sum.activated++;
    if (r.validated) sum.validated++;
    if (r.notRelevant) sum.notRelevant++;
    if (r.failed) sum.failed++;
    if (r.state === "needs_manual_review") sum.manualReview++;
  })))));
  await query("UPDATE source_discovery_runs SET completed_at=now(), status='success', candidates_seen=$2, validated=$3, activated=$4, rejected_not_india=$5, failed=$6, details=$7::jsonb WHERE id=$1", [run!.id, sum.processed, sum.validated, sum.activated, sum.notRelevant, sum.failed, JSON.stringify({ byState: sum.byState })]);
  return sum;
}
