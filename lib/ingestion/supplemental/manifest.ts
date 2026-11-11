// Daily check of the supplemental dataset manifest (https://storage.stapply.ai/jobhive/v1/manifest.json, kalil0321/ats-scrapers).
// It is a SNAPSHOT feed, not proof of instant updates and not a replacement for direct employer sources. This module only READS
// the manifest and records what it says. Job rows from the feed are NOT stored or redistributed: the repository's MIT licence
// covers its code; the hosted dataset's data-use terms have not been verified (see docs/INGESTION.md), so ingestion stays off.
import { httpRequest } from "../http";
import { getState, putState } from "../discovery/candidates";

export const MANIFEST_URL = process.env.JOB_SUPPLEMENTAL_MANIFEST_URL || "https://storage.stapply.ai/jobhive/v1/manifest.json";
export const SUPPLEMENTAL_INGESTION_ENABLED = false; // flips only after the hosted data's terms are verified in writing

export interface ManifestSummary {
  checkedAt: string; url: string; updatedAt: string | null; generatedAt: string | null; atsCount: number | null; totalCompanies: number | null; totalJobs: number | null;
  sources: { ats: string; rows: number | null; url: string | null }[]; changedSinceLast: boolean; topLevelKeys: string[]; termsVerified: false; ingestionEnabled: boolean;
}
const numOr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOr = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Tolerant parser: reads only fields that are actually present; unknown shapes yield nulls, never invented values. */
export function parseManifest(raw: unknown): Omit<ManifestSummary, "checkedAt" | "url" | "changedSinceLast" | "termsVerified" | "ingestionEnabled"> {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const stats = (m.stats && typeof m.stats === "object" ? m.stats : {}) as Record<string, unknown>;
  const src = m.sources ?? m.ats ?? m.datasets ?? m.artifacts;
  const entries: [string, any][] = Array.isArray(src) ? src.map((e: any, i) => [String(e?.ats ?? e?.name ?? i), e]) : src && typeof src === "object" ? Object.entries(src) : [];
  const sources = entries.map(([k, v]) => ({ ats: String(v?.ats ?? k), rows: numOr(v?.rows ?? v?.row_count ?? v?.count ?? v?.jobs), url: strOr(v?.url ?? v?.data_url ?? v?.href) }));
  return {
    updatedAt: strOr(m.updated_at), generatedAt: strOr(m.generated_at), atsCount: numOr(m.ats_count ?? stats.ats_count) ?? (sources.length || null),
    totalCompanies: numOr(stats.total_companies ?? m.total_companies ?? m.company_count), totalJobs: numOr(stats.total_jobs ?? m.total_jobs), sources, topLevelKeys: Object.keys(m).slice(0, 30),
  };
}

export async function checkSupplementalManifest(o: { fetchText?: (u: string) => Promise<string> } = {}): Promise<ManifestSummary> {
  const get = o.fetchText ?? (async (u: string) => (await httpRequest(u, { timeoutMs: 30_000, maxBytes: 5_000_000 })).text);
  const parsed = parseManifest(JSON.parse(await get(MANIFEST_URL)));
  const prev = await getState<ManifestSummary>("stapply_manifest");
  const stamp = parsed.updatedAt ?? parsed.generatedAt;
  const summary: ManifestSummary = { checkedAt: new Date().toISOString(), url: MANIFEST_URL, ...parsed, changedSinceLast: !prev || (prev.updatedAt ?? prev.generatedAt) !== stamp, termsVerified: false, ingestionEnabled: SUPPLEMENTAL_INGESTION_ENABLED };
  await putState("stapply_manifest", summary);
  return summary;
}
