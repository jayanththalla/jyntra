// Orchestration for `npm run jobs:discover-seed`: inventory import + bounded real-endpoint validation + a detailed report.
import { query } from "@/lib/database";
import { httpStats, resetHttpStats } from "../http";
import { KeyedLimiter } from "../limiter";
import { hostKeyOf, hostLimitKeys, PROVIDER_LIMITS } from "../scheduler";
import { toSource } from "../providers/detect";
import { candidateCounts } from "./candidates";
import type { CandidateInput } from "./candidates";
import { collectInventory, type FetchText } from "./ats-inventory";
import { runInventoryDiscovery, type InventoryRunReport } from "./inventory-run";
import { processQueue, type QueueSummary } from "./pipeline";
import { validateBoard, type BoardValidationStatus } from "./validation";
import { PROVIDER_PRIORITY } from "./ats-inventory";
import type { ProviderId } from "../types";

export interface SeedOptions { provider?: string | null; limit?: number | null; offset?: number; dryRun?: boolean; validate?: boolean; concurrency?: number; fetchText?: FetchText; token?: string | null }
export interface ValidationTally {
  checked: number; byStatus: Partial<Record<BoardValidationStatus, number>>; byProvider: Record<string, Partial<Record<BoardValidationStatus, number>>>;
  indiaRelevantBoards: number; boardsWithTrackedCityJobs: number; jobsSeen: number; jobsByCity: Record<string, number>;
  examples: { provider: string; board: string; status: BoardValidationStatus; jobs: number; india: number; bengaluru: number; hyderabad: number; chennai: number; error?: string }[];
}
export interface SeedReport {
  startedAt: string; durationMs: number; dryRun: boolean; options: Omit<SeedOptions, "fetchText" | "token">;
  inventory: InventoryRunReport; validation: ValidationTally | null; queue?: QueueSummary; candidatesByState?: Record<string, number>;
  http: { requests: number; bytes: number; byStatus: Record<string, number> };
  registeredSources?: number; networkNote?: string;
}

const emptyTally = (): ValidationTally => ({ checked: 0, byStatus: {}, byProvider: {}, indiaRelevantBoards: 0, boardsWithTrackedCityJobs: 0, jobsSeen: 0, jobsByCity: {}, examples: [] });

/** Read-only validation of candidates with NO database access (dry run). Same adapters, same status mapping as the real pipeline. */
export async function validateCandidatesDry(cands: CandidateInput[], o: { concurrency?: number } = {}): Promise<ValidationTally> {
  const tally = emptyTally();
  const global = new KeyedLimiter(o.concurrency ?? 4);
  const byProvider = new KeyedLimiter(3, PROVIDER_LIMITS);
  const byHost = new KeyedLimiter(1);
  await Promise.all(cands.map((c) => global.run(["all"], () => byProvider.run([`p:${c.provider}`], () => byHost.run(hostLimitKeys(c.provider!, hostKeyOf({ provider: c.provider!, board_slug: c.boardSlug ?? null, tenant: c.tenant ?? null, host: c.host ?? null })), async () => {
    const src = toSource("dry-run", { provider: c.provider as ProviderId, boardSlug: c.boardSlug ?? null, tenant: c.tenant ?? null, host: c.host ?? null, careerSite: c.careerSite ?? null, sourceUrl: c.careersUrl ?? "" });
    const v = await validateBoard(src, { maxPages: 3 });
    tally.checked++;
    tally.byStatus[v.status] = (tally.byStatus[v.status] ?? 0) + 1;
    const bp = (tally.byProvider[c.provider!] ??= {});
    bp[v.status] = (bp[v.status] ?? 0) + 1;
    tally.jobsSeen += v.jobsSeen;
    for (const [k, n] of Object.entries(v.cityCounts)) if (!k.startsWith("city:")) tally.jobsByCity[k] = (tally.jobsByCity[k] ?? 0) + n;
    if (v.indiaJobs > 0) tally.indiaRelevantBoards++;
    const tracked = (v.cityCounts["city:bengaluru"] ?? 0) + (v.cityCounts["city:hyderabad"] ?? 0) + (v.cityCounts["city:chennai"] ?? 0);
    if (tracked > 0) tally.boardsWithTrackedCityJobs++;
    if (tally.examples.length < 25 && (v.indiaJobs > 0 || v.status !== "valid_with_jobs")) tally.examples.push({ provider: c.provider!, board: c.boardSlug ?? `${c.tenant}/${c.careerSite}`, status: v.status, jobs: v.jobsSeen, india: v.indiaJobs, bengaluru: v.cityCounts["city:bengaluru"] ?? 0, hyderabad: v.cityCounts["city:hyderabad"] ?? 0, chennai: v.cityCounts["city:chennai"] ?? 0, error: v.error });
  })))));
  return tally;
}

/** Tally from persisted source_validations rows written since `since` (the DB path). */
async function tallyFromDb(since: Date, provider?: string | null): Promise<ValidationTally> {
  const tally = emptyTally();
  const rows = await query<{ provider: string; board_ref: string; status: BoardValidationStatus; jobs_seen: number | null; india_jobs: number | null; city_counts: Record<string, number>; error: string | null }>(
    "SELECT provider, board_ref, status, jobs_seen, india_jobs, city_counts, error FROM source_validations WHERE checked_at >= $1 AND ($2::text IS NULL OR provider = $2) ORDER BY id", [since.toISOString(), provider ?? null]);
  for (const r of rows) {
    tally.checked++;
    tally.byStatus[r.status] = (tally.byStatus[r.status] ?? 0) + 1;
    const bp = (tally.byProvider[r.provider] ??= {});
    bp[r.status] = (bp[r.status] ?? 0) + 1;
    tally.jobsSeen += r.jobs_seen ?? 0;
    for (const [k, n] of Object.entries(r.city_counts ?? {})) if (!k.startsWith("city:")) tally.jobsByCity[k] = (tally.jobsByCity[k] ?? 0) + n;
    if ((r.india_jobs ?? 0) > 0) tally.indiaRelevantBoards++;
    const cc = r.city_counts ?? {};
    const tracked = (cc["city:bengaluru"] ?? 0) + (cc["city:hyderabad"] ?? 0) + (cc["city:chennai"] ?? 0);
    if (tracked > 0) tally.boardsWithTrackedCityJobs++;
    if (tally.examples.length < 25 && ((r.india_jobs ?? 0) > 0 || r.status !== "valid_with_jobs")) tally.examples.push({ provider: r.provider, board: r.board_ref, status: r.status, jobs: r.jobs_seen ?? 0, india: r.india_jobs ?? 0, bengaluru: cc["city:bengaluru"] ?? 0, hyderabad: cc["city:hyderabad"] ?? 0, chennai: cc["city:chennai"] ?? 0, error: r.error ?? undefined });
  }
  return tally;
}

export async function runDiscoverSeed(o: SeedOptions = {}): Promise<SeedReport> {
  const t0 = Date.now();
  const startedAt = new Date();
  resetHttpStats();
  const validate = o.validate !== false;
  const inventory = await runInventoryDiscovery({ provider: o.provider, limit: o.limit, offset: o.offset, dryRun: o.dryRun, fetchText: o.fetchText, token: o.token, method: "ats_inventory_seed" });
  let validation: ValidationTally | null = null;
  let queue: QueueSummary | undefined;
  let candidatesByState: Record<string, number> | undefined;
  let registeredSources: number | undefined;
  if (validate) {
    if (o.dryRun) {
      const inv = await collectInventory({ provider: o.provider, fetchText: o.fetchText, token: o.token });
      const sample = inv.candidates.slice(o.offset ?? 0, o.limit ? (o.offset ?? 0) + o.limit : undefined);
      validation = await validateCandidatesDry(sample, { concurrency: o.concurrency });
    } else {
      queue = await processQueue({ limit: o.limit ?? 100, ignoreDailyLimit: true, concurrency: o.concurrency, provider: o.provider, method: "validate_queue" });
      validation = await tallyFromDb(startedAt, o.provider);
      candidatesByState = await candidateCounts();
      registeredSources = Number((await query<{ c: string }>("SELECT count(*)::text c FROM job_sources"))[0]!.c);
    }
  }
  const report: SeedReport = {
    startedAt: startedAt.toISOString(), durationMs: Date.now() - t0, dryRun: !!o.dryRun,
    options: { provider: o.provider, limit: o.limit, offset: o.offset, dryRun: o.dryRun, validate, concurrency: o.concurrency },
    inventory, validation, queue, candidatesByState, registeredSources,
    http: { requests: httpStats.requests, bytes: httpStats.bytes, byStatus: { ...httpStats.byStatus } },
  };
  // An honest signal when every request failed at the network layer (e.g. egress blocked): never present that as "boards not found".
  if (validation && validation.checked > 0 && (validation.byStatus.temporarily_unavailable ?? 0) === validation.checked) {
    report.networkNote = "Every validation request failed at the network layer (timeout/DNS/connection refused). Results say nothing about the boards themselves; run from an environment that can reach the ATS hosts.";
  }
  return report;
}

export { PROVIDER_PRIORITY };
