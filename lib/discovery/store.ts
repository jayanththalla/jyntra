// Persisting source results: dedup (domain → LinkedIn → normalized name), merge without
// overwriting verified data with blanks, and change detection for "show again" logic.
import { safeHttpUrl } from "@/lib/url";
import { normalizeJob, type NormalizedJob } from "@/lib/normalize";
import { isSameJob } from "@/lib/jobs/dedupe";
import type { CandidateProfile, JobResult, StartupResult } from "@/lib/types";
import { query, withTransaction, type Q } from "@/lib/database";
import { domainOf, normalizeLinkedin, normalizeName } from "@/lib/deduplication";
import { classifyStartup } from "@/lib/classification";
import {
  consolidateFunding,
  fundingStage,
  fundingStatus,
  isNewStartup,
  isRecentYcBatch,
  parseAmount,
  toUsd,
  ycBatchFundingDate,
  type FundingReport,
} from "@/lib/funding";
import { usdRates, type UsdRates } from "@/lib/fx";
import { confidenceRank } from "@/lib/country";
import type { FundingResult } from "@/lib/types";
import { isJobBeyondListedWindow } from "@/lib/jobs/age";
import { settings } from "@/config/settings";
import { matchJob } from "@/lib/matching";
import { locationTags } from "@/lib/jobs/location";
import { candidateSkillSet } from "@/lib/matching/skills";

export interface UpsertOutcome {
  id: number;
  created: boolean;
  /** Not stored: a new startup without recent funding. */
  skipped?: boolean;
  newJobs: number;
  newRelevantJobs: string[];
  changes: string[];
}

async function findExisting(r: StartupResult, domain: string | null, linkedin: string | null, norm: string) {
  if (domain) {
    const rows = await query("SELECT * FROM startups WHERE domain = $1", [domain]);
    if (rows[0]) return rows[0];
  }
  if (linkedin) {
    const rows = await query("SELECT * FROM startups WHERE linkedin_url = $1", [linkedin]);
    if (rows[0]) return rows[0];
  }
  if (norm.length >= 3) {
    // Name match only if it doesn't contradict a known domain.
    const rows = await query("SELECT * FROM startups WHERE normalized_name = $1 ORDER BY id LIMIT 5", [norm]);
    const hit = rows.find((s: any) => !domain || !s.domain || s.domain === domain);
    if (hit) return hit;
  }
  return null;
}

/** Which source is more authoritative for company facts (higher wins). */
const PRIORITY: Record<string, number> = { yc: 4, company_careers: 3, search: 2, remotive: 2, himalayas: 2, funding_rss: 1, startupmaps: 1 };
const priority = (s: string | undefined) => (s ? PRIORITY[s] ?? 0 : 0);

function same(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Funding date a new startup is judged by: dated news, else its YC batch (approximate Demo Day). */
function resultFundingDate(r: StartupResult): string | null {
  return r.funding?.date ?? ycBatchFundingDate(r.funding?.round) ?? null;
}

/** New startups are added only if funded recently (or in a YC batch from this year); known startups keep getting updates. */
export function fundedRecentlyEnough(r: StartupResult, now = new Date()): boolean {
  if (r.allowWithoutFunding) return true;
  if (isRecentYcBatch(r.funding?.round, now)) return true;
  const date = resultFundingDate(r);
  if (!date) return false;
  return (now.getTime() - new Date(date).getTime()) / 86_400_000 <= settings.addFundedWithinDays;
}

/**
 * Safe under concurrency: if two runs try to create the same company at once, the loser hits the unique
 * domain index (23505). It simply retries, now finds the company the winner created, and updates it.
 */
export async function upsertStartup(input: StartupResult, profile: CandidateProfile): Promise<UpsertOutcome> {
  // Links from outside are only ever stored as plain http(s) URLs (never javascript:, data:, …).
  const r: StartupResult = {
    ...input,
    website: safeHttpUrl(input.website),
    linkedinUrl: safeHttpUrl(input.linkedinUrl),
    careersUrl: safeHttpUrl(input.careersUrl),
    sourceUrl: safeHttpUrl(input.sourceUrl) ?? "",
    funding: input.funding ? { ...input.funding, sourceUrl: safeHttpUrl(input.funding.sourceUrl) ?? "" } : input.funding,
  };
  for (let attempt = 0; ; attempt++) {
    try {
      return await upsertStartupOnce(r, profile);
    } catch (e) {
      if ((e as { code?: string }).code === "23505" && attempt < 3) continue;
      throw e;
    }
  }
}

async function upsertStartupOnce(r: StartupResult, profile: CandidateProfile): Promise<UpsertOutcome> {
  const domain = domainOf(r.website);
  const linkedin = normalizeLinkedin(r.linkedinUrl);
  const norm = normalizeName(r.name);
  const existing = await findExisting(r, domain, linkedin, norm);
  if (!existing && !fundedRecentlyEnough(r)) {
    return { id: 0, created: false, skipped: true, newJobs: 0, newRelevantJobs: [], changes: [] };
  }
  const changes: string[] = [];

  // ----- merge simple fields -----
  const fieldSources: Record<string, { source: string; url: string }> = { ...(existing?.field_sources ?? {}) };
  const merged: Record<string, any> = {};
  const simple: [string, any][] = [
    ["website", r.website ?? null],
    ["domain", domain],
    ["linkedin_url", linkedin],
    ["github_url", r.githubUrl ?? null],
    ["careers_url", r.careersUrl ?? null],
    ["description", r.description ?? null],
    ["location", r.location ?? null],
    ["founded_year", r.foundedYear ?? null],
  ];
  for (const [field, value] of simple) {
    const old = existing?.[field] ?? null;
    if (value == null || value === "") {
      merged[field] = old;
      continue;
    }
    const prev = fieldSources[field]?.source ?? existing?.source;
    // Higher-priority sources win; a source may refresh its own data (except news, where
    // different articles would keep overwriting each other).
    const mayOverwrite = !existing || priority(r.source) > priority(prev) || (r.source === prev && r.source !== "funding_rss");
    if (old == null || (mayOverwrite && !same(old, value))) {
      if (existing && old != null && !same(old, value) && field !== "domain") changes.push(field.replace(/_/g, " "));
      if (existing && old == null && field === "careers_url") changes.push("career page found");
      merged[field] = value;
      if (field !== "domain") fieldSources[field] = { source: r.source, url: r.sourceUrl };
    } else {
      merged[field] = old;
    }
  }

  // ----- funding: every report is kept; the main round is derived from all of them -----
  const rates = (await usdRates())?.rates ?? null;
  const reports = mergeFundingReports(existingReports(existing, rates), r.funding ? reportFrom(r.funding, rates) : null);
  const old = {
    last_funding_date: existing?.last_funding_date ? String(existing.last_funding_date).slice(0, 10) : null,
    last_funding_amount: existing?.last_funding_amount ?? null,
    funding_round: existing?.funding_round ?? null,
    investors: existing?.investors ?? null,
    funding_source: existing?.funding_source ?? null,
    funding_source_url: existing?.funding_source_url ?? null,
  };
  const cf = consolidateFunding(reports);
  const p = cf.primary;
  const funding = p
    ? {
        last_funding_date: cf.announcement_date,
        last_funding_amount: p.amount,
        funding_round: p.round,
        investors: p.investors.length ? p.investors : null,
        funding_source: p.source,
        funding_source_url: p.url || null,
      }
    : old;
  if (existing && p && !same(funding, old)) changes.push("funding");
  const fundingExtra = {
    funding_stage: p ? fundingStage(p.round) : existing?.funding_stage ?? null,
    funding_kind: p?.kind ?? existing?.funding_kind ?? null,
    funding_currency: p?.currency ?? null,
    funding_amount_value: p?.amount_value ?? null,
    funding_amount_usd: p?.amount_usd ?? null,
    funding_verification_url: cf.verification_url,
    funding_conflicts: JSON.stringify(cf.conflicts),
    funding_reports: JSON.stringify(reports),
  };

  // ----- headquarters: stronger evidence wins; disagreeing evidence of the same strength is flagged -----
  const hqOld = {
    hq_country: existing?.hq_country ?? null,
    hq_confidence: existing?.hq_confidence ?? null,
    hq_evidence: existing?.hq_evidence ?? null,
    hq_source_url: existing?.hq_source_url ?? null,
  };
  let hq = hqOld;
  const hqConflicts: string[] = [];
  if (r.hq?.country) {
    const newRank = confidenceRank(r.hq.confidence);
    const oldRank = confidenceRank(hqOld.hq_confidence);
    if (hqOld.hq_country && hqOld.hq_country !== r.hq.country && newRank === oldRank) {
      hqConflicts.push(`Headquarters: ${hqOld.hq_evidence} says ${hqOld.hq_country}; ${r.hq.evidence} says ${r.hq.country}`);
    } else if (!hqOld.hq_country || newRank > oldRank || (newRank === oldRank && hqOld.hq_country === r.hq.country)) {
      hq = { hq_country: r.hq.country, hq_confidence: r.hq.confidence, hq_evidence: r.hq.evidence, hq_source_url: r.hq.sourceUrl };
      if (existing && hqOld.hq_country && hqOld.hq_country !== r.hq.country) changes.push("headquarters");
    }
  }
  if (hqConflicts.length) fundingExtra.funding_conflicts = JSON.stringify([...cf.conflicts, ...hqConflicts]);
  else if (existing?.funding_conflicts) {
    // Keep earlier HQ conflicts (they aren't re-derived from funding reports).
    const keep = (existing.funding_conflicts as string[]).filter((c) => c.startsWith("Headquarters:"));
    if (keep.length) fundingExtra.funding_conflicts = JSON.stringify([...new Set([...cf.conflicts, ...keep])]);
  }
  const otherLocations = [...new Set([...(existing?.other_locations ?? []), ...(r.otherLocations ?? [])])];
  const founders = r.founders?.length ? JSON.stringify(r.founders) : JSON.stringify(existing?.founders ?? []);

  // ----- classification (re-run when description/tags change) -----
  const tags = [...new Set([...(existing?.raw_tags ?? []), ...(r.tags ?? [])])];
  const cls = classifyStartup({
    name: r.name,
    description: merged.description,
    tags,
    industryHint: r.industryHint ?? null,
  });
  const keepOldCls =
    existing && existing.industry && (priority(r.source) < priority(existing.source) || (!r.tags?.length && !r.description));

  const sourcesSeen = [...new Set([...(existing?.sources_seen ?? []), r.source])];
  const values = {
    name: existing?.name ?? r.name,
    normalized_name: existing?.normalized_name ?? norm,
    ...merged,
    industry: keepOldCls ? existing.industry : cls.industry,
    is_ai: keepOldCls ? existing.is_ai : cls.is_ai,
    ai_category: keepOldCls ? existing.ai_category : cls.ai_category,
    classification_confidence: keepOldCls ? existing.classification_confidence : cls.classification_confidence,
    classification_reasons: JSON.stringify(keepOldCls ? existing.classification_reasons : cls.reasons),
    is_new_startup: isNewStartup(merged.founded_year),
    ...funding,
    ...fundingExtra,
    ...hq,
    other_locations: otherLocations,
    founders,
    funding_status: fundingStatus(funding.last_funding_date, funding.funding_round),
    sources_seen: sourcesSeen,
    field_sources: JSON.stringify(fieldSources),
    raw_tags: tags,
  };

  let id: number;
  let created = false;
  if (!existing) {
    const cols = Object.keys(values);
    const rows = await query<{ id: number }>(
      `INSERT INTO startups (${cols.join(",")}, source, source_url, last_change_reason)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}, $${cols.length + 1}, $${cols.length + 2}, 'New discovery')
       RETURNING id`,
      [...Object.values(values), r.source, r.sourceUrl]
    );
    id = rows[0].id;
    created = true;
  } else {
    id = existing.id;
    const cols = Object.keys(values);
    await query(
      `UPDATE startups SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")}, last_seen_at = now()
       ${changes.length ? `, last_updated_at = now(), last_change_reason = $${cols.length + 2}` : ""}
       WHERE id = $${cols.length + 1}`,
      [...Object.values(values), id, ...(changes.length ? [`Updated: ${changes.join(", ")}`] : [])]
    );
  }

  // ----- emails (merge, newest check wins for each address) -----
  if (r.emails) {
    const [row] = await query<{ emails: any[] }>("SELECT emails FROM startups WHERE id = $1", [id]);
    const byEmail = new Map<string, any>((row?.emails ?? []).map((e: any) => [e.email, e]));
    for (const e of r.emails) byEmail.set(e.email, e);
    await query("UPDATE startups SET emails = $2, emails_checked_at = now() WHERE id = $1", [id, JSON.stringify([...byEmail.values()])]);
  }

  // ----- jobs -----
  const { newJobs, newRelevant } = await upsertJobs(id, r, profile);
  if (!created && newRelevant.length) {
    await query(
      "UPDATE startups SET last_updated_at = now(), last_change_reason = $2 WHERE id = $1",
      [id, `New relevant job: ${newRelevant.slice(0, 3).join(", ")}`]
    );
  }
  await refreshRemoteAvailable(id);
  return { id, created, newJobs, newRelevantJobs: newRelevant, changes };
}

/** A source's funding as a stored report, with amount parsed and converted to USD when possible. */
export function reportFrom(f: FundingResult, rates: UsdRates | null): FundingReport {
  const parsed = parseAmount(f.amount);
  return {
    source: f.source,
    url: f.sourceUrl,
    date: f.date,
    amount: f.amount,
    round: f.round,
    investors: f.investors ?? [],
    kind: f.kind ?? "confirmed",
    currency: parsed?.currency ?? null,
    amount_value: parsed?.value ?? null,
    amount_usd: toUsd(parsed, rates),
  };
}

/** Reports already stored; rows from before reports existed are turned into one report from their columns. */
function existingReports(existing: any, rates: UsdRates | null): FundingReport[] {
  if (!existing) return [];
  const stored = (existing.funding_reports ?? []) as FundingReport[];
  if (stored.length) return stored;
  if (!existing.funding_round && !existing.last_funding_date) return [];
  return [
    reportFrom(
      {
        date: existing.last_funding_date ? String(existing.last_funding_date).slice(0, 10) : null,
        amount: existing.last_funding_amount ?? null,
        round: existing.funding_round ?? null,
        investors: existing.investors ?? [],
        source: existing.funding_source ?? "Unknown source",
        sourceUrl: existing.funding_source_url ?? "",
        kind: existing.funding_kind ?? "confirmed",
      },
      rates
    ),
  ];
}

/** Same article = same report (refreshed); keeps the 12 most recent. */
export function mergeFundingReports(list: FundingReport[], next: FundingReport | null): FundingReport[] {
  const out = next ? [...list.filter((r) => !(r.url && r.url === next.url) && !(!r.url && r.source === next.source && r.round === next.round)), next] : [...list];
  const key = (r: FundingReport) => r.date ?? ycBatchFundingDate(r.round) ?? "";
  return out.sort((a, b) => key(b).localeCompare(key(a))).slice(0, 12);
}

/** Records a possible duplicate for a human to review. Never merges or deletes anything. */
async function logCandidate(q: Q, kind: string, a: string, b: string, reason: string) {
  await q(
    "INSERT INTO duplicate_candidates (kind, ref_a, ref_b, reason) VALUES ($1,$2,$3,$4) ON CONFLICT (kind, ref_a, ref_b) DO NOTHING",
    [kind, a.slice(0, 500), b.slice(0, 500), reason]
  );
}

const sameTitle = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, "") === b.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Stores one startup's jobs. Identity, in priority order:
 *   1. (source, external_id)  — the source's own id
 *   2. canonical URL           — same posting, tracking params/casing/trailing slash aside
 *   3. same title + same KNOWN location from ANOTHER source — kept once (first source wins)
 * A match UPDATES the existing row (same id), so saved jobs and applications keep pointing at it.
 * Same title with an unknown location is only logged as a candidate, never merged.
 * The whole startup runs in one transaction under an advisory lock, so concurrent runs can't both insert.
 */
async function upsertJobs(startupId: number, r: StartupResult, profile: CandidateProfile) {
  const owned = candidateSkillSet(profile);
  let newJobs = 0;
  const newRelevant: string[] = [];
  if (!r.jobs) return { newJobs, newRelevant };
  const fetchedAt = new Date();
  const jobs = (r.jobs as JobResult[]).map((j) => normalizeJob(j, fetchedAt)).filter((j): j is NormalizedJob => !!j);

  await withTransaction(async (q) => {
    await q("SELECT pg_advisory_xact_lock(hashtext($1))", [`jobs:${startupId}`]);
    const others = await q<{ id: number; job_url: string; canonical_url: string | null; job_title: string; location: string | null }>(
      "SELECT id, job_url, canonical_url, job_title, location FROM jobs WHERE startup_id = $1 AND is_active AND source <> $2",
      [startupId, r.source]
    );
    const seenIds: number[] = [];

    for (const j of jobs) {
      // Only DATED postings beyond the listed window are skipped (not adding them to seenIds also marks stored copies
      // inactive below). Recent and older-but-still-listed roles are kept; Discover decides what is shown by default.
      if (isJobBeyondListedWindow(j.postedDate, fetchedAt)) continue;

      // 1–2. Same posting from this source?
      let existing: { id: number; job_url: string } | undefined;
      if (j.externalId) {
        [existing] = await q("SELECT id, job_url FROM jobs WHERE source = $1 AND external_id = $2", [j.source, j.externalId]);
      }
      if (!existing) {
        [existing] = await q("SELECT id, job_url FROM jobs WHERE job_url = $1 OR canonical_url = $1 LIMIT 1", [j.canonicalUrl]);
      }

      // 3. Same role already stored from ANOTHER source?
      if (!existing) {
        const dup = others.find((o) => isSameJob({ url: o.job_url, title: o.job_title, location: o.location }, { url: j.url, title: j.title, location: j.location }));
        if (dup) {
          await logCandidate(q, "job", String(dup.id), j.canonicalUrl, `same title+location as job ${dup.id}; kept the ${r.source === "company_careers" ? "other" : "first"} source's copy`);
          continue;
        }
        const maybe = others.find((o) => sameTitle(o.job_title, j.title));
        if (maybe) await logCandidate(q, "job", String(maybe.id), j.canonicalUrl, "same title, location unknown or different: NOT merged");
      }

      // Don't let a URL change collide with another row's unique job_url.
      let urlToStore = j.canonicalUrl;
      if (existing && existing.job_url !== j.canonicalUrl) {
        const [clash] = await q("SELECT id FROM jobs WHERE job_url = $1 AND id <> $2", [j.canonicalUrl, existing.id]);
        if (clash) urlToStore = existing.job_url;
      }

      const params = [
        startupId, j.title, urlToStore, j.applyUrl ?? null, j.location ?? null, j.remote, j.remoteScope ?? null,
        j.employmentType ?? null, j.postedDate, j.minExperience ?? null, j.salary ?? null, j.skills ?? [],
        j.description ?? null, j.source, j.sourceUrl, j.externalId, j.canonicalUrl, j.postedPrecision, j.verification,
      ];
      let id: number;
      let inserted = false;
      if (existing) {
        id = existing.id;
        await q(
          `UPDATE jobs SET job_title = $2, job_url = $3, apply_url = COALESCE($4, apply_url), location = $5, remote = $6, remote_scope = $7,
             employment_type = $8, min_experience = $10, salary = $11, skills = $12,
             description = COALESCE($13, description), source_url = $15,
             external_id = COALESCE($16, external_id), canonical_url = $17, verification = COALESCE($19, verification),
             -- an exact date always wins; an approximate one only fills a gap (it would otherwise creep forward on every refresh)
             posted_date = CASE WHEN $18 = 'exact' THEN $9 ELSE COALESCE(posted_date, $9) END,
             posted_precision = CASE WHEN $18 = 'exact' THEN 'exact' ELSE COALESCE(posted_precision, $18) END,
             last_seen_at = now(), last_verified_at = now(), is_stale = false, is_active = true
           -- $1 and $14 are shared with the INSERT; mentioning them lets Postgres infer their types.
           -- (The row's owning source is deliberately NOT changed: the same posting may arrive via two sources.)
           WHERE id = $20 AND startup_id = $1 AND $14::text IS NOT NULL`,
          [...params, existing.id]
        );
      } else {
        const rows = await q<{ id: number }>(
          `INSERT INTO jobs (startup_id, job_title, job_url, apply_url, location, remote, remote_scope, employment_type,
             posted_date, min_experience, salary, skills, description, source, source_url, external_id, canonical_url, posted_precision, verification)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           ON CONFLICT (job_url) DO UPDATE SET last_seen_at = now(), is_active = true
           RETURNING id, (xmax = 0) AS inserted`,
          params
        );
        id = rows[0].id;
        inserted = (rows[0] as any).inserted === true;
      }
      seenIds.push(id);

      if (inserted) {
        newJobs++;
        const m = matchJob(
          {
            job_title: j.title,
            skills: j.skills ?? [],
            description: j.description ?? null,
            min_experience: j.minExperience ?? null,
            location: j.location ?? null,
            remote_scope: j.remoteScope ?? null,
            location_tags: locationTags(j.location, j.remote, j.remoteScope ?? null),
          },
          profile,
          owned
        );
        if (m.relevance === "strong" || m.relevance === "potential") newRelevant.push(j.title);
      }
    }
    // Jobs from this source that disappeared from the listing are no longer active (kept, not deleted).
    // Only when the whole listing was read: a failed or rate-limited request is not evidence that a posting closed.
    if (r.jobsComplete !== false)
    await q(`UPDATE jobs SET is_active = false WHERE startup_id = $1 AND source = $2 AND NOT (id = ANY($3::int[]))`, [startupId, r.source, seenIds]);
  });
  return { newJobs, newRelevant };
}

async function refreshRemoteAvailable(id: number) {
  await query(
    `UPDATE startups SET remote_available = (
       SELECT CASE WHEN bool_or(remote = 'yes') THEN true
                   WHEN count(*) > 0 AND bool_and(remote = 'no') THEN false
                   ELSE NULL END
       FROM jobs WHERE startup_id = $1 AND is_active)
     WHERE id = $1`,
    [id]
  );
}
