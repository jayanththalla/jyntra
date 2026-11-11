// "Find Startups Today": runs every enabled source, stores results, records a run log.
import { getDiscoveryProfile, query } from "@/lib/database";
import { generateQueries } from "./queries";
import { upsertStartup } from "./store";
import { invalidateSharedData } from "./read";
import { ENRICHERS, SOURCES } from "@/sources";
import type { DiscoveryContext, StartupSource } from "@/lib/types";
import { withAdvisoryLock } from "@/lib/refresh/lock";
import { FetchError, errorCategory } from "@/lib/http";
import { recordSourceRun } from "@/lib/refresh/health";
import { settings } from "@/config/settings";

export interface RunState {
  runId: number | null;
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
  stats: { startups: number; created: number; updated: number; jobs: number; newJobs: number; errors: number };
  /** Per-source progress, so the UI can show what is running instead of one long spinner. */
  sources: { name: string; state: "pending" | "running" | "done" | "failed" | "skipped"; note?: string }[];
}

const g = globalThis as unknown as { __run?: RunState };
function state(): RunState {
  if (!g.__run) {
    g.__run = {
      runId: null,
      running: false,
      startedAt: null,
      finishedAt: null,
      log: [],
      stats: { startups: 0, created: 0, updated: 0, jobs: 0, newJobs: 0, errors: 0 },
      sources: [],
    };
  }
  return g.__run;
}

export function runStatus(): RunState {
  return state();
}

/** Starts a run in the background. Returns false if one is already running. */
export function startDiscovery(): boolean {
  const s = state();
  if (s.running) return false;
  s.running = true;
  s.log = [];
  s.sources = [];
  s.stats = { startups: 0, created: 0, updated: 0, jobs: 0, newJobs: 0, errors: 0 };
  s.startedAt = new Date().toISOString();
  s.finishedAt = null;
  runDiscovery().catch((e) => {
    s.log.push(`Run failed: ${(e as Error).message}`);
    s.running = false;
  });
  return true;
}

/**
 * Runs discovery once. A PostgreSQL advisory lock makes this safe across processes and instances: if another
 * run is already active anywhere, this call logs that and returns without starting a second one.
 */
export async function runDiscovery(onLog?: (m: string) => void): Promise<RunState> {
  const s = state();
  s.running = true;
  const locked = await withAdvisoryLock("discovery", () => runDiscoveryBody(onLog)).catch((e) => {
    s.log.push(`Run failed: ${(e as Error).message}`);
    s.running = false;
    s.finishedAt = new Date().toISOString();
    return null;
  });
  if (locked && !locked.ran) {
    const line = `${new Date().toLocaleTimeString()}  Another refresh is already running (database lock). Skipped.`;
    s.log.push(line);
    onLog?.(line);
    s.running = false;
    s.finishedAt = new Date().toISOString();
  }
  return s;
}

/** Hard time budget per source so one hung provider can't block the others (or hold the lock forever). */
function withBudget<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`${name} exceeded its ${Math.round(ms / 60000)}-minute time budget`)), ms)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function runDiscoveryBody(onLog?: (m: string) => void): Promise<RunState> {
  const s = state();
  s.running = true;
  const log = (m: string) => {
    const line = `${new Date().toLocaleTimeString()}  ${m}`;
    s.log.push(line);
    onLog?.(line);
  };
  const [{ id: runId }] = await query<{ id: number }>("INSERT INTO discovery_runs DEFAULT VALUES RETURNING id");
  s.runId = runId;
  try {
    const profile = await getDiscoveryProfile();
    const ctx: DiscoveryContext = {
      profile,
      queries: generateQueries(profile),
      log,
      careersCandidates: [],
    };

    let okSources = 0;
    const progress = (src: StartupSource, state: RunState["sources"][number]["state"], note?: string) => {
      const row = s.sources.find((x) => x.name === src.name);
      if (row) Object.assign(row, { state, note });
      else s.sources.push({ name: src.name, state, note });
    };

    /**
     * Reads every source at the same time (each has its own hosts and per-host delay, so a slow one no longer
     * holds up the rest), then stores the results one source at a time in the order given, richest source first.
     */
    const runGroup = async (group: StartupSource[], countsAsReached = true) => {
      for (const src of group) progress(src, "pending");
      const reads = group.map(async (src) => {
        const reason = src.disabledReason();
        if (reason) return { src, skipped: reason } as const;
        progress(src, "running");
        log(`${src.name}: starting`);
        const t0 = Date.now();
        try {
          return { src, t0, results: await withBudget(src.discover(ctx), settings.sourceBudgetMs, src.name) } as const;
        } catch (e) {
          return { src, t0, error: (e as Error).message, category: errorCategory(e), retryAfterSeconds: e instanceof FetchError ? e.retryAfterSeconds : undefined } as const;
        }
      });
      for (const read of reads) {
        const r = await read;
        const { src } = r;
        if ("skipped" in r) {
          log(`${src.name}: skipped — ${r.skipped}`);
          progress(src, "skipped", r.skipped);
          await query("UPDATE sources SET last_status = $2 WHERE id = $1", [src.id, `skipped: ${r.skipped}`]);
          continue;
        }
        if ("error" in r) {
          s.stats.errors++;
          log(`${src.name}: failed — ${r.error}`);
          progress(src, "failed", r.error);
          await recordSourceRun(src.id, { ok: false, error: r.error, category: r.category, retryAfterSeconds: r.retryAfterSeconds, durationMs: Date.now() - r.t0 }).catch(() => {});
          continue;
        }
        let created = 0;
        let skipped = 0;
        for (const res of r.results) {
          try {
            const out = await upsertStartup(res, profile);
            if (out.skipped) {
              skipped++;
              continue;
            }
            s.stats.startups++;
            s.stats.jobs += res.jobs?.length ?? 0;
            s.stats.newJobs += out.newJobs;
            if (out.created) created++;
            else if (out.changes.length || out.newRelevantJobs.length) s.stats.updated++;
          } catch (e) {
            s.stats.errors++;
            log(`  could not store ${res.name}: ${(e as Error).message}`);
          }
        }
        s.stats.created += created;
        const note = `${r.results.length} startups, ${created} new${skipped ? `, ${skipped} skipped (not funded recently)` : ""}`;
        log(`${src.name}: ${note}`);
        progress(src, "done", note);
        if (countsAsReached) okSources++;
        await recordSourceRun(src.id, { ok: true, note, durationMs: Date.now() - r.t0 }).catch(() => {});
      }
    };

    // Open source fills its own table and needs nothing from the others, so it runs with the main sources.
    const independent = ENRICHERS.filter((e) => e.id === "oss_github");
    const dependent = ENRICHERS.filter((e) => e.id !== "oss_github");
    await runGroup([...SOURCES, ...independent]);

    // Careers-page candidates: recently funded first, then startups with no jobs yet, then the rest.
    ctx.careersCandidates = await query(
      `SELECT s.id, s.name, s.website FROM startups s
       WHERE s.website IS NOT NULL
         AND (s.careers_url IS NULL
              OR s.emails_checked_at IS NULL
              -- re-read boards we already found jobs on, so new openings show up daily
              OR EXISTS (SELECT 1 FROM jobs j WHERE j.startup_id = s.id AND j.source = 'company_careers'))
       ORDER BY (s.last_funding_date IS NOT NULL) DESC,
                (s.emails_checked_at IS NULL) DESC,
                EXISTS (SELECT 1 FROM jobs j WHERE j.startup_id = s.id AND j.is_active) ASC,
                s.first_discovered_at DESC`
    );
    await runGroup(dependent, false); // reads only what is already stored, so it proves nothing about the internet

    // A run where nothing could be read is a failure, never "checked today": the dashboard must not look healthy.
    const reached = okSources > 0;
    log(reached ? `Done. ${s.stats.created} new startups, ${s.stats.updated} updated, ${s.stats.newJobs} new jobs.` : "Failed: no source could be reached. Check the server's internet access and try again.");
    await query("UPDATE discovery_runs SET finished_at = now(), status = $4, log = $2, stats = $3 WHERE id = $1", [
      runId,
      JSON.stringify(s.log),
      JSON.stringify(s.stats),
      reached ? "done" : "failed",
    ]);
  } catch (e) {
    log(`Run failed: ${(e as Error).message}`);
    await query("UPDATE discovery_runs SET finished_at = now(), status = 'failed', log = $2 WHERE id = $1", [runId, JSON.stringify(s.log)]);
  } finally {
    s.running = false;
    s.finishedAt = new Date().toISOString();
    invalidateSharedData(); // dashboards pick up the new startups/jobs on their next load
  }
  return s;
}
