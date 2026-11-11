// Import of open ATS board registries (e.g. the jobscraper_hourly companies.json, mherzog4/job-boards). Entries become
// CANDIDATES only; none is a source until it passes validation and the India-relevance gate in pipeline.ts.
import { query } from "@/lib/database";
import { normalizeCompanyName } from "@/lib/normalize";
import { HOST_LABEL, SLUG } from "../providers/util";
import { isProviderId } from "../providers";
import { EIGHTFOLD_DOMAIN } from "../providers/eightfold";
import { ORACLE_POD, ORACLE_SITE, ORACLE_TENANT } from "../providers/oracle";
import type { CandidateInput } from "./candidates";

const WD_SITE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const WD_CLUSTER = /^wd\d{1,3}$/i;

export interface RegistryParse { candidates: CandidateInput[]; unsupported: Record<string, number>; invalid: number; total: number }

/** Accepts `[{name, ats, token, host?, site?}]` (jobscraper_hourly) or `{companies|boards:[...]}`; `slug` is accepted for `token`. */
export function parseRegistry(raw: unknown, origin: string): RegistryParse {
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.companies) ? (raw as any).companies : Array.isArray((raw as any)?.boards) ? (raw as any).boards : [];
  const out: RegistryParse = { candidates: [], unsupported: {}, invalid: 0, total: list.length };
  for (const e of list) {
    if (!e || typeof e !== "object") { out.invalid++; continue; }
    const r = e as Record<string, unknown>;
    const ats = String(r.ats ?? r.vendor ?? "").toLowerCase();
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 200) : "";
    const token = String(r.token ?? r.slug ?? "").trim();
    if (!isProviderId(ats)) { out.unsupported[ats || "unknown"] = (out.unsupported[ats || "unknown"] ?? 0) + 1; continue; }
    if (!name || !token) { out.invalid++; continue; }
    const base = { name, provider: ats, origin, originRef: token };
    if (ats === "workday") {
      const host = String(r.host ?? ""), site = String(r.site ?? "");
      if (!HOST_LABEL.test(token) || !WD_CLUSTER.test(host) || !WD_SITE.test(site)) { out.invalid++; continue; }
      out.candidates.push({ ...base, tenant: token, host: host.toLowerCase(), careerSite: site });
    } else if (ats === "oracle") {
      const host = String(r.host ?? ""), site = String(r.site ?? "");
      if (!ORACLE_TENANT.test(token) || !ORACLE_POD.test(host) || !ORACLE_SITE.test(site)) { out.invalid++; continue; }
      out.candidates.push({ ...base, tenant: token.toLowerCase(), host: host.toLowerCase(), careerSite: site });
    } else if (ats === "eightfold") {
      const domain = String(r.site ?? r.domain ?? "");
      if (!HOST_LABEL.test(token) || !EIGHTFOLD_DOMAIN.test(domain)) { out.invalid++; continue; }
      out.candidates.push({ ...base, boardSlug: token.toLowerCase(), careerSite: domain.toLowerCase() });
    } else if (ats === "darwinbox" || ats === "keka") {
      const site = typeof r.site === "string" && r.site ? r.site : null;
      if (!HOST_LABEL.test(token) || (site && !/^[A-Za-z0-9_-]{1,40}$/.test(site))) { out.invalid++; continue; }
      out.candidates.push({ ...base, boardSlug: token, careerSite: site });
    } else if (["recruitee", "breezy", "personio"].includes(ats)) {
      if (!HOST_LABEL.test(token)) { out.invalid++; continue; }
      out.candidates.push({ ...base, boardSlug: token });
    } else {
      if (!SLUG.test(token)) { out.invalid++; continue; }
      out.candidates.push({ ...base, boardSlug: token });
    }
  }
  return out;
}

/** Bulk insert (idempotent). Returns how many were new. */
export async function importCandidates(cands: CandidateInput[], chunk = 500): Promise<{ inserted: number; seen: number }> {
  let inserted = 0;
  for (let i = 0; i < cands.length; i += chunk) {
    const part = cands.slice(i, i + chunk);
    const rows = await query<{ id: number }>(
      `INSERT INTO discovery_candidates (name, normalized_name, provider, board_slug, tenant, host, career_site, origin, origin_ref, state, priority)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::int[])
       ON CONFLICT (provider, COALESCE(board_slug,''), COALESCE(tenant,''), COALESCE(host,''), COALESCE(career_site,'')) WHERE provider IS NOT NULL DO NOTHING RETURNING id`,
      [part.map((c) => c.name), part.map((c) => normalizeCompanyName(c.name) || c.name.toLowerCase()), part.map((c) => c.provider ?? null), part.map((c) => c.boardSlug ?? null), part.map((c) => c.tenant ?? null),
        part.map((c) => c.host ?? null), part.map((c) => c.careerSite ?? null), part.map((c) => c.origin), part.map((c) => c.originRef ?? null), part.map(() => "ats_detected"), part.map((c) => c.priority ?? 0)],
    );
    inserted += rows.length;
  }
  return { inserted, seen: cands.length };
}
