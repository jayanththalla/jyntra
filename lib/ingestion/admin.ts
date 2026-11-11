// Admin operations. Only allowlisted provider adapters are ever run; a submitted URL is parsed for a known ATS pattern,
// never fetched as an arbitrary endpoint.
import { query } from "@/lib/database";
import { assertPublicHttpsUrl } from "@/lib/net/public-url";
import { atsBoardUrlFor } from "./board-url";
import { addCandidate, setCandidate } from "./discovery/candidates";
import { processCandidate } from "./discovery/pipeline";
import { normalizeWebsite } from "./discovery/leads";
import { getProvider, isProviderId } from "./providers";
import { detectAts, toSource } from "./providers/detect";
import { ensureCompany, getSource, toJobSource, upsertSource } from "./source-store";
import type { JobSource, ProviderId } from "./types";

export type AdminResult = { ok: boolean; error?: string; sourceId?: number; companySlug?: string; validation?: unknown; candidateId?: number; state?: string };

/** Add a company from a name plus a careers URL (ATS URL or the company's own careers page) or a website. */
export async function addCompany(i: { name: string; careersUrl?: string; website?: string }): Promise<AdminResult> {
  const name = i.name?.trim();
  if (!name || name.length > 200) return { ok: false, error: "name is required" };
  let careers: string | undefined;
  if (i.careersUrl) { try { careers = (await assertPublicHttpsUrl(i.careersUrl)).toString(); } catch (e) { return { ok: false, error: `careers URL rejected: ${(e as Error).message}` }; } }
  let website: string | null = null;
  if (i.website) { website = normalizeWebsite(i.website); if (!website) return { ok: false, error: "website is not a valid public https URL" }; }
  const det = careers ? detectAts(careers) : null;
  const cand = await addCandidate({ name, websiteUrl: website, careersUrl: careers ?? null, provider: det?.provider ?? null, boardSlug: det?.boardSlug, tenant: det?.tenant, host: det?.host, careerSite: det?.careerSite, origin: "admin" });
  const r = await processCandidate(cand.id);
  const [row] = await query<any>("SELECT company_slug, source_id, last_error FROM discovery_candidates WHERE id=$1", [cand.id]);
  return { ok: r.state === "active_source", candidateId: cand.id, state: r.state, companySlug: row?.company_slug ?? undefined, sourceId: row?.source_id ?? undefined, error: r.state === "active_source" ? undefined : r.notRelevant ? "board is valid but lists no jobs for Bengaluru, Hyderabad or India-remote right now" : row?.last_error ?? r.note };
}

/** Add an explicit board (provider + identifiers) for an existing/new company. It is validated against the real endpoint first. */
export async function addBoard(i: { companyName: string; provider: string; boardSlug?: string; tenant?: string; host?: string; careerSite?: string; priority?: "high" | "normal"; pollIntervalMinutes?: number }): Promise<AdminResult> {
  if (!isProviderId(i.provider)) return { ok: false, error: `unsupported provider (allowed: ${["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "recruitee", "workday", "personio", "breezy", "keka", "darwinbox"].join(", ")})` };
  const probe: JobSource = { id: null, companySlug: "pending", provider: i.provider as ProviderId, boardSlug: i.boardSlug ?? null, tenant: i.tenant ?? null, host: i.host ?? null, careerSite: i.careerSite ?? null, sourceUrl: null, etag: null, lastModified: null, config: {} };
  const v = await getProvider(i.provider).validateSource(probe);
  if (!v.ok) return { ok: false, error: `board validation failed: ${v.error ?? "unknown"}`, validation: v };
  const url = atsBoardUrlFor({ provider: i.provider as ProviderId, boardSlug: probe.boardSlug, tenant: probe.tenant, host: probe.host, careerSite: probe.careerSite });
  const slug = await ensureCompany(i.companyName, { careersUrl: url });
  const sourceId = await upsertSource({ ...probe, companySlug: slug, sourceUrl: url, priority: i.priority, pollIntervalMinutes: i.pollIntervalMinutes, validation: { ok: true, at: new Date().toISOString(), jobsSeen: v.jobCount, sample: v.sample, origin: "admin" } });
  return { ok: true, sourceId, companySlug: slug, validation: v };
}

export async function validateSourceNow(id: number): Promise<AdminResult> {
  const row = await getSource(id);
  if (!row) return { ok: false, error: "source not found" };
  const v = await getProvider(row.provider).validateSource({ ...toJobSource(row), etag: null, lastModified: null });
  await query("UPDATE job_sources SET validation=$2::jsonb, updated_at=now() WHERE id=$1", [id, JSON.stringify({ ...v, at: new Date().toISOString() })]);
  return { ok: v.ok, validation: v, error: v.error };
}

export async function retrySource(id: number): Promise<AdminResult> {
  const n = await query("UPDATE job_sources SET next_check_at=now(), status='active', consecutive_failures=0, consecutive_rate_limits=0, locked_until=NULL, updated_at=now() WHERE id=$1 RETURNING id", [id]);
  return n.length ? { ok: true, sourceId: id } : { ok: false, error: "source not found" };
}
export async function pauseSource(id: number): Promise<AdminResult> {
  const n = await query("UPDATE job_sources SET status='paused', updated_at=now() WHERE id=$1 RETURNING id", [id]);
  return n.length ? { ok: true, sourceId: id } : { ok: false, error: "source not found" };
}
export const reactivateSource = retrySource;

export async function rejectCandidateToReview(id: number, reason: string) { await setCandidate(id, "needs_manual_review", { error: reason.slice(0, 300) }); }
