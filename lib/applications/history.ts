// Historical application import: pure logic (no database). Nothing here invents data.
//  - a missing contact stays null ("Not provided" is never turned into an address)
//  - an imported record is never "Applied": its status is unknown until the user says otherwise
//  - duplicates are detected conservatively: same company + same role (or same job URL). A company match with
//    a different or missing role is only flagged "possible", never merged automatically.
import { normalizeCompanyName } from "@/lib/normalize";
import { canonicalUrl, safeHttpUrl } from "@/lib/url";

export type MatchKind = "new" | "duplicate" | "possible_duplicate";
export type Region = "india" | "international" | "unspecified";

export interface RawCandidate {
  company: string;
  role?: string | null;
  contact?: string | null;
  jobUrl?: string | null;
  region?: Region;
}
export interface Candidate {
  company: string;
  role: string | null;
  contactEmail: string | null;
  jobUrl: string | null;
  region: Region;
  dedupeKey: string;
}
export interface ExistingApp {
  id: number;
  company: string | null;
  role: string | null;
  jobUrl: string | null;
}

/** User-supplied historical records. Roles/contacts are exactly as given; international companies have no role or contact. */
export const HISTORICAL_SEED: RawCandidate[] = [
  { company: "TheAISCHOOL", role: "Software Developer Intern", contact: "hr@theaischool.co", region: "india" },
  { company: "PALMONAS", role: "IT Intern", contact: "careers@palmonas.com", region: "india" },
  { company: "Alchemyst AI", role: "Full Stack AI Engineer Intern", contact: "Not provided", region: "india" },
  { company: "TVH", role: "AI Engineer Intern", contact: "jobs.india@tvh.com", region: "india" },
  { company: "Kanerika", role: "Software Engineer", contact: "talent.acquisition@kanerika.com", region: "india" },
  { company: "Cardboard", role: "Product Engineer (Full Stack)", contact: "Not provided", region: "india" },
  { company: "Chargebee", role: "SDE Intern", contact: "chris.dias@chargebee.com", region: "india" },
  { company: "Cubiktech", role: "Software Engineering Intern", contact: "hiring@cubiktech.com", region: "india" },
  ...["Sakana AI", "Fujitsu Research", "HENNGE", "Estuary", "Assume AI", "Tangram Vision", "OneChronos", "This Dot", "Playit.gg"].map(
    (company): RawCandidate => ({ company, region: "international" })
  ),
];

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const NOT_PROVIDED = /^(not provided|n\/a|na|none|unknown|-|—|tbd)?$/i;

/** A valid, lower-cased address or null. Placeholders such as "Not provided" become null; nothing is ever guessed. */
export function cleanEmail(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (NOT_PROVIDED.test(t)) return null;
  if (t.length > 254 || /[\r\n\s,;<>]/.test(t)) return null;
  return EMAIL.test(t) ? t.toLowerCase() : null;
}

/** Role comparison key: case, punctuation and spacing ignored; wording is kept (an "Intern" is not an "Engineer"). */
export function normalizeRole(role: string | null | undefined): string {
  return (role ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bsde\b/g, "software development engineer")
    .replace(/\bsoftware engineering\b/g, "software engineer")
    .replace(/\bsoftware developer\b/g, "software engineer")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function dedupeKey(company: string, role: string | null | undefined, jobUrl?: string | null): string {
  const url = canonicalUrl(jobUrl ?? null);
  if (url) return `url:${url}`;
  return `co:${normalizeCompanyName(company)}|role:${normalizeRole(role)}`;
}

export function toCandidate(raw: RawCandidate): Candidate | null {
  const company = (raw.company ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!company || !normalizeCompanyName(company)) return null;
  const role = (raw.role ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  const jobUrl = safeHttpUrl(raw.jobUrl ?? null);
  return { company, role, contactEmail: cleanEmail(raw.contact), jobUrl, region: raw.region ?? "unspecified", dedupeKey: dedupeKey(company, role, jobUrl) };
}

/**
 * Compares one candidate with the user's existing applications.
 *  duplicate           same canonical job URL, or same company AND same normalized role
 *  possible_duplicate  same company, but the role differs or one side has none: shown to the user, never merged automatically
 *  new                 no company match
 */
export function classify(c: Candidate, existing: ExistingApp[]): { kind: MatchKind; matchId: number | null } {
  const co = normalizeCompanyName(c.company);
  const role = normalizeRole(c.role);
  const url = canonicalUrl(c.jobUrl);
  let possible: number | null = null;
  for (const e of existing) {
    const eUrl = canonicalUrl(e.jobUrl);
    if (url && eUrl && url === eUrl) return { kind: "duplicate", matchId: e.id };
    if (!e.company || normalizeCompanyName(e.company) !== co) continue;
    const eRole = normalizeRole(e.role);
    const urlsDiffer = !!(url && eUrl && url !== eUrl);
    if (role && eRole && role === eRole && !urlsDiffer) return { kind: "duplicate", matchId: e.id };
    possible ??= e.id; // same company, role differs or unknown
  }
  return possible !== null ? { kind: "possible_duplicate", matchId: possible } : { kind: "new", matchId: null };
}

/** Removes repeats inside one pasted batch (same dedupe key). The first occurrence wins; later ones are reported, not silently lost. */
export function dedupeBatch(raws: RawCandidate[]): { candidates: Candidate[]; invalid: number; repeated: string[] } {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const repeated: string[] = [];
  let invalid = 0;
  for (const r of raws) {
    const c = toCandidate(r);
    if (!c) { invalid++; continue; }
    if (seen.has(c.dedupeKey)) { repeated.push(c.company); continue; }
    seen.add(c.dedupeKey);
    candidates.push(c);
  }
  return { candidates, invalid, repeated };
}

/** Fields a merge may fill on an existing application: only those that are currently empty. Status is never touched. */
export function mergePatch(existing: { contact_email: string | null; role_title: string | null; record_source: string | null }, c: Candidate) {
  return {
    contact_email: existing.contact_email ?? c.contactEmail,
    role_title: existing.role_title ?? c.role,
    record_source: existing.record_source ?? "historical_summary",
  };
}
