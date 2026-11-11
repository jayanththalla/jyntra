// Discovery queue. A candidate is only ever a LEAD until its board has been validated against the real endpoint.
import { query } from "@/lib/database";
import { normalizeCompanyName } from "@/lib/normalize";
import type { ProviderId } from "../types";

export const CANDIDATE_STATES = ["candidate_discovered", "website_identified", "career_page_identified", "ats_detected", "board_validated", "active_source", "failed_source", "needs_manual_review"] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

export interface CandidateInput {
  name: string;
  websiteUrl?: string | null;
  careersUrl?: string | null;
  provider?: ProviderId | null;
  boardSlug?: string | null;
  tenant?: string | null;
  host?: string | null;
  careerSite?: string | null;
  origin: string;
  originRef?: string | null;
  /** Validation order: higher first (default 0). */
  priority?: number;
}

export interface CandidateRow {
  id: number; name: string; normalized_name: string; website_url: string | null; official_domain: string | null; careers_url: string | null;
  provider: ProviderId | null; board_slug: string | null; tenant: string | null; host: string | null; career_site: string | null;
  origin: string; origin_ref: string | null; state: CandidateState; evidence: Record<string, unknown>; attempts: number; last_error: string | null;
  next_attempt_at: string; company_slug: string | null; source_id: number | null;
}

export const initialState = (c: CandidateInput): CandidateState => (c.provider ? "ats_detected" : c.careersUrl ? "career_page_identified" : c.websiteUrl ? "website_identified" : "candidate_discovered");

export async function addCandidate(c: CandidateInput): Promise<{ id: number; isNew: boolean }> {
  const norm = normalizeCompanyName(c.name) || c.name.toLowerCase();
  if (c.provider) {
    const rows = await query<{ id: number }>(
      `INSERT INTO discovery_candidates (name, normalized_name, website_url, careers_url, provider, board_slug, tenant, host, career_site, origin, origin_ref, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (provider, COALESCE(board_slug,''), COALESCE(tenant,''), COALESCE(host,''), COALESCE(career_site,'')) WHERE provider IS NOT NULL DO NOTHING RETURNING id`,
      [c.name, norm, c.websiteUrl ?? null, c.careersUrl ?? null, c.provider, c.boardSlug ?? null, c.tenant ?? null, c.host ?? null, c.careerSite ?? null, c.origin, c.originRef ?? null, initialState(c)],
    );
    if (rows[0]) return { id: rows[0].id, isNew: true };
    const [ex] = await query<{ id: number }>(
      `SELECT id FROM discovery_candidates WHERE provider=$1 AND COALESCE(board_slug,'')=COALESCE($2,'') AND COALESCE(tenant,'')=COALESCE($3,'') AND COALESCE(host,'')=COALESCE($4,'') AND COALESCE(career_site,'')=COALESCE($5,'')`,
      [c.provider, c.boardSlug ?? null, c.tenant ?? null, c.host ?? null, c.careerSite ?? null],
    );
    return { id: ex!.id, isNew: false };
  }
  const [ex] = await query<{ id: number }>("SELECT id FROM discovery_candidates WHERE provider IS NULL AND normalized_name=$1 LIMIT 1", [norm]);
  if (ex) {
    await query("UPDATE discovery_candidates SET website_url=COALESCE(website_url,$2), careers_url=COALESCE(careers_url,$3), updated_at=now() WHERE id=$1", [ex.id, c.websiteUrl ?? null, c.careersUrl ?? null]);
    return { id: ex.id, isNew: false };
  }
  const [row] = await query<{ id: number }>(
    `INSERT INTO discovery_candidates (name, normalized_name, website_url, careers_url, origin, origin_ref, state) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [c.name, norm, c.websiteUrl ?? null, c.careersUrl ?? null, c.origin, c.originRef ?? null, initialState(c)],
  );
  return { id: row!.id, isNew: true };
}

export async function getCandidate(id: number): Promise<CandidateRow | null> {
  return (await query<CandidateRow>("SELECT * FROM discovery_candidates WHERE id=$1", [id]))[0] ?? null;
}

export async function setCandidate(id: number, state: CandidateState, patch: { evidence?: Record<string, unknown>; error?: string | null; nextAttemptInSeconds?: number; attempts?: number; provider?: ProviderId | null; boardSlug?: string | null; tenant?: string | null; host?: string | null; careerSite?: string | null; careersUrl?: string | null; companySlug?: string | null; sourceId?: number | null } = {}) {
  await query(
    `UPDATE discovery_candidates SET state=$2, evidence = evidence || $3::jsonb, last_error=$4, attempts=COALESCE($5, attempts),
       next_attempt_at = now() + make_interval(secs => $6::int),
       provider=COALESCE($7, provider), board_slug=COALESCE($8, board_slug), tenant=COALESCE($9, tenant), host=COALESCE($10, host), career_site=COALESCE($11, career_site),
       careers_url=COALESCE($12, careers_url), company_slug=COALESCE($13, company_slug), source_id=COALESCE($14, source_id), updated_at=now() WHERE id=$1`,
    [id, state, JSON.stringify(patch.evidence ?? {}), patch.error ?? null, patch.attempts ?? null, patch.nextAttemptInSeconds ?? 0, patch.provider ?? null, patch.boardSlug ?? null, patch.tenant ?? null, patch.host ?? null, patch.careerSite ?? null, patch.careersUrl ?? null, patch.companySlug ?? null, patch.sourceId ?? null],
  );
}

/** Candidates that are due for another step. `board_validated` ones are re-checked later because open roles change. */
export async function dueCandidates(limit: number, provider?: string | null): Promise<CandidateRow[]> {
  return query<CandidateRow>(
    `SELECT * FROM discovery_candidates
     WHERE state IN ('candidate_discovered','website_identified','career_page_identified','ats_detected','failed_source','board_validated') AND next_attempt_at <= now() AND ($2::text IS NULL OR provider = $2)
     ORDER BY (state='ats_detected') DESC, priority DESC, next_attempt_at LIMIT $1`,
    [limit, provider ?? null],
  );
}

export async function candidateCounts(): Promise<Record<string, number>> {
  const rows = await query<{ state: string; c: string }>("SELECT state, count(*)::text c FROM discovery_candidates GROUP BY state");
  return Object.fromEntries(rows.map((r) => [r.state, Number(r.c)]));
}

export async function getState<T = Record<string, unknown>>(key: string): Promise<T | null> {
  return (await query<{ value: T }>("SELECT value FROM discovery_state WHERE key=$1", [key]))[0]?.value ?? null;
}
export async function putState(key: string, value: unknown) {
  await query("INSERT INTO discovery_state (key, value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()", [key, JSON.stringify(value)]);
}
