// One bounded pass over due sources, with per-provider and per-host concurrency limits. Used by the long-running
// worker, by `npm run jobs:sync` (cron / GitHub Actions) and by the protected POST /api/cron/refresh?scope=ingest.
import { KeyedLimiter } from "./limiter";
import { runSource, type RunOutcome } from "./runner";
import { claimDueSources, releaseLeases, type SourceRow } from "./source-store";
import type { ProviderId } from "./types";

export function ingestionEnabled(env = process.env) {
  return env.JOB_INGESTION_ENABLED !== "false";
}
export function ingestionConcurrency(env = process.env) {
  const n = Number(env.JOB_INGESTION_CONCURRENCY ?? 5);
  return Number.isFinite(n) ? Math.min(20, Math.max(1, Math.floor(n))) : 5;
}

/** Host that a source's requests go to (the unit that must not be hit in parallel). */
export function hostKeyOf(s: Pick<SourceRow, "provider" | "board_slug" | "tenant" | "host"> & { config?: Record<string, unknown> | null }): string {
  const sub = s.board_slug ?? "";
  switch (s.provider as ProviderId) {
    case "greenhouse": return "boards-api.greenhouse.io";
    case "lever": return s.config?.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
    case "ashby": return "api.ashbyhq.com";
    case "smartrecruiters": return "api.smartrecruiters.com";
    case "workable": return "apply.workable.com";
    case "recruitee": return `${sub}.recruitee.com`;
    case "personio": return `${sub}.jobs.personio.de`;
    case "breezy": return `${sub}.breezy.hr`;
    case "keka": return `${sub}.keka.com`;
    case "darwinbox": return `${sub}.darwinbox.in`;
    case "oracle": return `${s.tenant}.${s.host}.oraclecloud.com`;
    case "eightfold": return `${s.board_slug}.eightfold.ai`;
    case "workday": return `${s.tenant}.${s.host}.myworkdayjobs.com`;
    default: return s.provider;
  }
}

/** Per-provider concurrency (keys are `p:<provider>`, the same keys the limiter is called with). */
export const PROVIDER_LIMITS: Record<string, number> = { "p:workday": 2, "p:darwinbox": 1, "p:oracle": 2, "p:eightfold": 2, "p:greenhouse": 4, "p:lever": 3, "p:ashby": 3, "p:smartrecruiters": 3, "p:workable": 3 };
/** Providers whose boards all share ONE API host. The per-provider limit governs them; a per-host limit of 1 would serialise every board. */
const SHARED_API_HOST = new Set<string>(["greenhouse", "lever", "ashby", "smartrecruiters", "workable"]);
export const hostLimitKeys = (provider: string, hostKey: string): string[] => (SHARED_API_HOST.has(provider) ? [] : [`h:${hostKey}`]);

export interface PassSummary {
  claimed: number; success: number; notModified: number; partial: number; failed: number; cancelled: number;
  jobsInserted: number; jobsUpdated: number; jobsClosed: number; durationMs: number; failures: Record<string, number>;
}

export async function runPass(o: { limit?: number; concurrency?: number; leaseSeconds?: number; budgetMs?: number; signal?: AbortSignal; now?: () => Date } = {}): Promise<PassSummary> {
  const t0 = Date.now();
  const sum: PassSummary = { claimed: 0, success: 0, notModified: 0, partial: 0, failed: 0, cancelled: 0, jobsInserted: 0, jobsUpdated: 0, jobsClosed: 0, durationMs: 0, failures: {} };
  if (!ingestionEnabled()) return sum;
  const budgetMs = o.budgetMs ?? 5 * 60_000;
  const global = new KeyedLimiter(o.concurrency ?? ingestionConcurrency());
  const byProvider = new KeyedLimiter(3, PROVIDER_LIMITS);
  const byHost = new KeyedLimiter(1);
  const lease = o.leaseSeconds ?? 15 * 60;
  const rows = await claimDueSources(o.limit ?? 50, lease, o.now?.());
  sum.claimed = rows.length;
  const pending = new Set(rows.map((r) => r.id));
  const tally = (r: RunOutcome) => {
    if (r.status === "success") sum.success++;
    else if (r.status === "not_modified") sum.notModified++;
    else if (r.status === "partial") sum.partial++;
    else if (r.status === "cancelled") sum.cancelled++;
    else { sum.failed++; sum.failures[r.category ?? "network"] = (sum.failures[r.category ?? "network"] ?? 0) + 1; }
    sum.jobsInserted += r.stats?.inserted ?? 0; sum.jobsUpdated += r.stats?.updated ?? 0; sum.jobsClosed += r.stats?.closed ?? 0;
  };
  await Promise.all(rows.map((row) =>
    global.run(["all"], () => byProvider.run([`p:${row.provider}`], () => byHost.run(hostLimitKeys(row.provider, hostKeyOf(row)), async () => {
      if (o.signal?.aborted || Date.now() - t0 > budgetMs) return; // not started: lease released below
      tally(await runSource(row.id, { signal: o.signal, now: o.now }));
      pending.delete(row.id);
    }))),
  ));
  await releaseLeases([...pending]); // sources we claimed but never started become due again immediately
  sum.durationMs = Date.now() - t0;
  return sum;
}
