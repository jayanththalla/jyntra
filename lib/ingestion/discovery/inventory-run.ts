// DB-backed run of the ATS inventory import: enumerate → download → parse → dedupe → idempotent candidate import.
// Incremental by default (per-file ETag → 304 skips unchanged inventories); `force` re-reads everything (weekly broader refresh).
import { query } from "@/lib/database";
import { getState, putState } from "./candidates";
import { collectInventory, PROVIDER_PRIORITY, type FetchText, type InventoryResult } from "./ats-inventory";
import { importCandidates } from "./registry";

export interface InventoryRunOptions { provider?: string | null; limit?: number | null; offset?: number; dryRun?: boolean; force?: boolean; token?: string | null; fetchText?: FetchText; method?: string }
export interface InventoryRunReport {
  at: string; dryRun: boolean; provider: string | null; via: string; notes: string[];
  filesListed: number; filesDownloaded: number; filesNotModified: number; rowsRead: number;
  candidatesParsed: number; invalidRows: number; duplicatesRemoved: number; unsupportedRows: number; unsupportedByProvider: Record<string, number>;
  selected: number; inserted: number; alreadyKnown: number; byProvider: Record<string, number>; files: InventoryResult["files"];
}

export async function runInventoryDiscovery(o: InventoryRunOptions = {}): Promise<InventoryRunReport> {
  const prior = o.dryRun || o.force ? null : await getState<{ etags?: Record<string, string> }>("inventory_etags");
  const inv = await collectInventory({ provider: o.provider, token: o.token ?? process.env.GITHUB_TOKEN ?? null, fetchText: o.fetchText, etags: prior?.etags });
  const start = Math.max(0, o.offset ?? 0);
  const selected = inv.candidates.slice(start, o.limit ? start + o.limit : undefined).map((c) => ({ ...c, priority: PROVIDER_PRIORITY[c.provider!] ?? 0 }));
  const byProvider: Record<string, number> = {};
  for (const c of selected) byProvider[c.provider!] = (byProvider[c.provider!] ?? 0) + 1;
  let inserted = 0;
  if (!o.dryRun) {
    const [run] = await query<{ id: number }>("INSERT INTO source_discovery_runs (method) VALUES ($1) RETURNING id", [o.method ?? "ats_inventory"]);
    inserted = (await importCandidates(selected)).inserted;
    await query("UPDATE source_discovery_runs SET completed_at=now(), status='success', candidates_seen=$2, candidates_new=$3, details=$4::jsonb WHERE id=$1", [run!.id, selected.length, inserted, JSON.stringify({ provider: o.provider ?? null, files: inv.files.map((f) => ({ file: f.file, rows: f.rows, candidates: f.candidates, invalid: f.invalid, duplicates: f.duplicates, notModified: f.notModified, error: f.error ?? null })), unsupportedByProvider: inv.totals.unsupportedByProvider })]);
    // ETags are stored only after a COMPLETE import (a --limit sample must not mark unread rows as seen).
    if (!o.limit && !start && !o.provider) await putState("inventory_etags", { etags: inv.etags, at: new Date().toISOString() });
  }
  const report: InventoryRunReport = {
    at: new Date().toISOString(), dryRun: !!o.dryRun, provider: o.provider ?? null, via: inv.listing.via, notes: inv.listing.notes,
    filesListed: inv.totals.filesListed, filesDownloaded: inv.totals.filesDownloaded, filesNotModified: inv.files.filter((f) => f.notModified).length, rowsRead: inv.totals.rows,
    candidatesParsed: inv.totals.candidates, invalidRows: inv.totals.invalid, duplicatesRemoved: inv.totals.duplicates, unsupportedRows: inv.totals.unsupportedRows, unsupportedByProvider: inv.totals.unsupportedByProvider,
    selected: selected.length, inserted, alreadyKnown: o.dryRun ? 0 : selected.length - inserted, byProvider, files: inv.files,
  };
  if (!o.dryRun) await putState("inventory_last_run", report);
  return report;
}
