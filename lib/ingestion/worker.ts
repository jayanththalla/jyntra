// Long-running worker: polls the durable PostgreSQL schedule (job_sources.next_check_at), runs bounded passes, and runs
// incremental discovery on a daily cadence. Everything survives a restart because all state is in the database.
import http from "node:http";
import { getState, putState } from "./discovery/candidates";
import { discoverFromCdx } from "./discovery/cdx";
import { discoverFromCommonCrawl } from "./discovery/commoncrawl";
import { runInventoryDiscovery } from "./discovery/inventory-run";
import { discoveryBatchSize, processQueue } from "./discovery/pipeline";
import { checkSupplementalManifest } from "./supplemental/manifest";
import { importCandidates, parseRegistry } from "./discovery/registry";
import { ingestionEnabled, runPass, type PassSummary } from "./scheduler";

const DAY = 86_400_000;
export const discoveryEnabled = () => process.env.JOB_DISCOVERY_ENABLED !== "false";

export async function runDiscoveryCycle(o: { signal?: AbortSignal } = {}) {
  const out: Record<string, unknown> = {};
  if (!discoveryEnabled()) return { skipped: "JOB_DISCOVERY_ENABLED=false" };
  const st = (await getState<{ lastFullRefreshAt?: string; lastInventoryAt?: string; lastWeeklyInventoryAt?: string; lastManifestAt?: string }>("worker")) ?? {};
  const stamp = (k: keyof typeof st) => { st[k] = new Date().toISOString(); };
  const due = (k: keyof typeof st, ms: number) => !st[k] || Date.now() - Date.parse(st[k]!) > ms;
  const url = process.env.JOB_REGISTRY_URL;
  // Weekly: re-import the open registry (idempotent; only new boards become candidates).
  if (url && due("lastFullRefreshAt", 7 * DAY)) {
    try {
      const res = await fetch(url, { signal: o.signal });
      if (res.ok) {
        const p = parseRegistry(await res.json(), "registry:url");
        out.registry = { total: p.total, unsupported: p.unsupported, invalid: p.invalid, ...(await importCandidates(p.candidates)) };
        stamp("lastFullRefreshAt");
      } else out.registry = { error: `HTTP ${res.status}` };
    } catch (e) { out.registry = { error: (e as Error).message }; }
  }
  // ATS company inventories (kalil0321/ats-scrapers): daily incremental (ETag → unchanged files are skipped), weekly forced full re-read.
  if (process.env.JOB_DISCOVERY_INVENTORY !== "false" && due("lastInventoryAt", DAY)) {
    const weekly = due("lastWeeklyInventoryAt", 7 * DAY);
    try { out.inventory = { weekly, ...(({ files, ...r }) => r)(await runInventoryDiscovery({ force: weekly, method: weekly ? "ats_inventory_weekly" : "ats_inventory_daily" })) }; stamp("lastInventoryAt"); if (weekly) stamp("lastWeeklyInventoryAt"); }
    catch (e) { out.inventory = { error: (e as Error).message }; }
  }
  // Common Crawl: a few index blocks per cycle; the cursor is persisted so history is never rescanned.
  if (process.env.JOB_DISCOVERY_COMMONCRAWL !== "false") {
    try { const { cursor, ...r } = await discoverFromCommonCrawl({ maxBlocks: 5 }); out.commonCrawl = r; } catch (e) { out.commonCrawl = { error: (e as Error).message }; }
  }
  if (process.env.JOB_DISCOVERY_CDX === "true") {
    try { out.cdx = await discoverFromCdx(); } catch (e) { out.cdx = { error: (e as Error).message }; }
  }
  // Supplemental dataset manifest: read-only daily check (no job data is downloaded).
  if (process.env.JOB_SUPPLEMENTAL_MANIFEST !== "false" && due("lastManifestAt", DAY)) {
    try { const m = await checkSupplementalManifest(); out.manifest = { updatedAt: m.updatedAt, totalJobs: m.totalJobs, changed: m.changedSinceLast }; stamp("lastManifestAt"); } catch (e) { out.manifest = { error: (e as Error).message }; }
  }
  out.queue = await processQueue({ limit: discoveryBatchSize(), signal: o.signal });
  await putState("worker", { ...st, lastDiscoveryAt: new Date().toISOString() });
  return out;
}

export async function startWorker(o: { tickMs?: number; log?: (m: string) => void } = {}) {
  const log = o.log ?? ((m) => console.log(`[jobs-worker] ${m}`));
  const ctrl = new AbortController();
  let inFlight: Promise<unknown> = Promise.resolve();
  let last: { at: string; summary?: PassSummary; error?: string } | null = null;
  let lastDiscovery = 0;
  const stop = (sig: string) => { log(`${sig}: finishing in-flight work, then exiting`); ctrl.abort(); };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));

  const port = Number(process.env.JOB_WORKER_HEALTH_PORT);
  if (port > 0) http.createServer((_q, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: !!last && !last.error, enabled: ingestionEnabled(), last })); }).listen(port, () => log(`health on :${port}`));

  log(`started (ingestion=${ingestionEnabled()}, discovery=${discoveryEnabled()})`);
  const tick = o.tickMs ?? 30_000;
  while (!ctrl.signal.aborted) {
    inFlight = (async () => {
      try {
        const summary = await runPass({ signal: ctrl.signal });
        last = { at: new Date().toISOString(), summary };
        if (summary.claimed) log(`pass: claimed=${summary.claimed} ok=${summary.success} 304=${summary.notModified} partial=${summary.partial} failed=${summary.failed} +${summary.jobsInserted} ~${summary.jobsUpdated} -${summary.jobsClosed} in ${summary.durationMs}ms`);
        if (Date.now() - lastDiscovery > 15 * 60_000) { // import steps have their own daily/weekly stamps; the validation queue drains every 15 min under JOB_DISCOVERY_DAILY_LIMIT
          log(`discovery: ${JSON.stringify(await runDiscoveryCycle({ signal: ctrl.signal }))}`);
          lastDiscovery = Date.now();
        }
      } catch (e) { last = { at: new Date().toISOString(), error: (e as Error).message }; log(`pass failed: ${(e as Error).message}`); }
    })();
    await inFlight;
    await new Promise<void>((r) => { const t = setTimeout(r, tick); ctrl.signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });
  }
  await Promise.race([inFlight, new Promise((r) => setTimeout(r, 25_000))]);
  log("stopped");
}
