// Company-board discovery from the public ATS inventories published by kalil0321/ats-scrapers (`ats-companies/*.csv`, MIT).
// This module is PURE (no database): enumerate the CSV files, download + parse them, and map every row to a validated
// candidate. A row is only ever a LEAD; the validation pipeline decides whether the board is real and India-relevant.
//
// Technique credit: the "download public tenant lists → dedupe → validate each board against the real endpoint → keep the
// useful ones" approach follows smresponsibilities/jobscraper_hourly `src/bulk-import.ts` (MIT). See THIRD_PARTY_NOTICES.md.
import crypto from "node:crypto";
import { httpRequest, type HttpResult } from "../http";
import { IngestError, type ProviderId } from "../types";
import { isProviderId } from "../providers";
import { detectAts, type Detected } from "../providers/detect";
import { HOST_LABEL, SLUG } from "../providers/util";
import { EIGHTFOLD_DOMAIN } from "../providers/eightfold";
import { ORACLE_POD, ORACLE_SITE, ORACLE_TENANT } from "../providers/oracle";
import type { CandidateInput } from "./candidates";

export const INVENTORY_REPO = "kalil0321/ats-scrapers";
export const INVENTORY_RAW_BASE = `https://raw.githubusercontent.com/${INVENTORY_REPO}/main/ats-companies/`;
export const INVENTORY_API_URL = `https://api.github.com/repos/${INVENTORY_REPO}/contents/ats-companies`;
export const INVENTORY_TREE_URL = `https://github.com/${INVENTORY_REPO}/tree/main/ats-companies`;
export const INVENTORY_ORIGIN_PREFIX = "ats-scrapers:";
/** India-native ATS platforms are validated first (higher number = earlier). */
export const PROVIDER_PRIORITY: Partial<Record<ProviderId, number>> = { darwinbox: 10, keka: 10 };

export interface InventoryFile { name: string; provider: string; url: string }
export interface InventoryListing { files: InventoryFile[]; via: "github_api" | "github_tree_page"; notes: string[] }

/** `fetchText` is injectable for tests; the default goes through httpRequest (SSRF guard, size cap, test fixtures). */
export type FetchText = (url: string, headers?: Record<string, string>, o?: { etag?: string | null }) => Promise<Pick<HttpResult, "status" | "text" | "etag" | "notModified">>;
export const defaultFetchText: FetchText = (url, headers, o) => httpRequest(url, { headers, etag: o?.etag ?? null, timeoutMs: 30_000, maxBytes: 8_000_000 });

const csvName = (n: unknown): n is string => typeof n === "string" && /^[A-Za-z0-9_.-]+\.csv$/.test(n);

/** All `*.csv` files in `ats-companies/`. Uses the GitHub contents API (token optional); when that is rate-limited or
 *  refused, falls back to the repository tree page's JSON. Nothing is hardcoded: the platform list is whatever the repo publishes. */
export async function listInventoryFiles(o: { token?: string | null; fetchText?: FetchText } = {}): Promise<InventoryListing> {
  const fetchText = o.fetchText ?? defaultFetchText;
  const notes: string[] = [];
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  let names: string[] | null = null;
  let via: InventoryListing["via"] = "github_api";
  try {
    const r = await fetchText(INVENTORY_API_URL, headers);
    const data = JSON.parse(r.text) as unknown;
    if (!Array.isArray(data)) throw new Error("contents API did not return a directory listing");
    names = data.filter((e) => e && (e as any).type === "file").map((e) => (e as any).name).filter(csvName);
  } catch (e) {
    notes.push(`GitHub contents API unavailable (${(e as Error).message.slice(0, 80)}); used the repository tree page instead. Set GITHUB_TOKEN to use the API.`);
  }
  if (!names) {
    via = "github_tree_page";
    const r = await fetchText(INVENTORY_TREE_URL, { Accept: "application/json" });
    names = namesFromTreeJson(r.text);
    if (!names.length) throw new IngestError("could not enumerate ats-companies/ (API refused and tree page had no CSV entries)", "bad_response");
  }
  const files = [...new Set(names)].sort().map((name) => ({ name, provider: name.replace(/\.csv$/i, "").toLowerCase(), url: `${INVENTORY_RAW_BASE}${encodeURIComponent(name)}` }));
  return { files, via, notes };
}

/** Finds the directory entries inside GitHub's tree-page JSON without depending on the exact nesting. */
export function namesFromTreeJson(body: string): string[] {
  let doc: unknown;
  try { doc = JSON.parse(body); } catch { return []; }
  const found: string[] = [];
  const walk = (o: unknown, depth: number) => {
    if (depth > 8 || !o || typeof o !== "object") return;
    if (Array.isArray(o)) {
      const isEntryList = o.length > 0 && o.every((e) => e && typeof e === "object" && "name" in (e as object));
      if (isEntryList) {
        for (const e of o) {
          if (csvName((e as any).name)) found.push((e as any).name);
        }
      } else {
        for (const e of o) walk(e, depth + 1);
      }
      return;
    }
    for (const v of Object.values(o as Record<string, unknown>)) walk(v, depth + 1);
  };
  walk(doc, 0);
  return found;
}

/** RFC-4180 CSV: quoted fields, escaped quotes, CRLF/LF, embedded newlines, UTF-8 BOM. Returns objects keyed by the header row. */
export function parseCsv(input: string): { header: string[]; rows: Record<string, string>[] } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let field = "", rec: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"' && field === "") inQ = true;
    else if (ch === ",") { rec.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      rec.push(field); field = "";
      if (rec.length > 1 || rec[0] !== "") records.push(rec);
      rec = [];
    } else field += ch;
  }
  if (field !== "" || rec.length) { rec.push(field); if (rec.length > 1 || rec[0] !== "") records.push(rec); }
  const header = (records.shift() ?? []).map((h) => h.trim().toLowerCase());
  const rows = records.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { header, rows };
}

export type MapResult =
  | { kind: "candidate"; candidate: CandidateInput; slugMismatch: boolean }
  | { kind: "unsupported" }
  | { kind: "invalid"; reason: string };

const prettify = (s: string) => s.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const lc = (s: string | null | undefined) => (s ? s.toLowerCase() : s ?? null);

/** Identifier shapes per provider. These end up in URLs, so every one is checked here and again inside the adapter. */
function identifiersValid(p: ProviderId, d: { boardSlug: string | null; tenant: string | null; host: string | null; careerSite: string | null }): string | null {
  switch (p) {
    case "workday":
      if (!d.tenant || !HOST_LABEL.test(d.tenant)) return "invalid Workday tenant";
      if (!d.host || !/^wd\d{1,3}$/i.test(d.host)) return "invalid Workday cluster";
      if (!d.careerSite || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(d.careerSite)) return "invalid Workday site";
      return null;
    case "oracle":
      if (!d.tenant || !ORACLE_TENANT.test(d.tenant) || !d.host || !ORACLE_POD.test(d.host) || !d.careerSite || !ORACLE_SITE.test(d.careerSite)) return "invalid Oracle tenant/pod/site";
      return null;
    case "eightfold":
      if (!d.boardSlug || !HOST_LABEL.test(d.boardSlug)) return "invalid Eightfold tenant";
      if (!d.careerSite || !EIGHTFOLD_DOMAIN.test(d.careerSite)) return "missing tenant domain (never guessed)";
      return null;
    case "recruitee": case "breezy": case "personio": case "keka": case "darwinbox":
      return d.boardSlug && HOST_LABEL.test(d.boardSlug) ? null : "invalid subdomain";
    default:
      return d.boardSlug && SLUG.test(d.boardSlug) ? null : "invalid board slug";
  }
}

/** Maps one inventory row to a candidate. The careers URL is the source of truth (it is what the ATS actually serves);
 *  the `slug` column is used only when the URL is missing/unparsable. Anything not verifiably well-formed is rejected, never repaired. */
export function mapInventoryRow(fileProvider: string, row: Record<string, string>): MapResult {
  if (!isProviderId(fileProvider)) return { kind: "unsupported" };
  const provider = fileProvider;
  const url = row.url || "";
  let d: Detected | null = detectAts(url);
  if (d && d.provider !== provider) d = null; // a mismatching URL says nothing about this platform's board
  let boardSlug = d?.boardSlug ?? null, tenant = d?.tenant ?? null, host = d?.host ?? null, careerSite = d?.careerSite ?? null;
  let slugMismatch = false;

  if (!d) {
    // Fall back to the slug column only for platforms where a bare slug identifies the board.
    const slug = row.slug || "";
    if (!slug) return { kind: "invalid", reason: "no parseable careers URL or slug" };
    if (provider === "workday") {
      const [t, site] = slug.split("/");
      const m = /\/\/[a-z0-9-]+\.(wd\d{1,3})\.myworkdayjobs\.com/i.exec(url);
      if (!t || !site || !m) return { kind: "invalid", reason: "workday row without tenant/cluster/site" };
      tenant = t.toLowerCase(); host = m[1]!.toLowerCase(); careerSite = site;
    } else if (provider === "oracle" || provider === "eightfold") return { kind: "invalid", reason: `${provider} row without a parseable careers URL` };
    else boardSlug = slug;
  } else if (row.slug && provider !== "workday" && provider !== "oracle" && boardSlug && row.slug.toLowerCase() !== boardSlug.toLowerCase()) slugMismatch = true;

  if (provider === "eightfold") careerSite = (row.domain || "").toLowerCase() || null; // domain column only; never derived
  if (["recruitee", "breezy", "personio", "keka", "darwinbox", "eightfold"].includes(provider)) boardSlug = lc(boardSlug);
  tenant = lc(tenant); host = lc(host);

  const bad = identifiersValid(provider, { boardSlug, tenant, host, careerSite });
  if (bad) return { kind: "invalid", reason: bad };
  const name = (row.name || row.company_name || "").slice(0, 200).trim() || prettify(boardSlug ?? tenant ?? "");
  if (!name) return { kind: "invalid", reason: "no company name" };
  return { kind: "candidate", slugMismatch, candidate: { name, provider, boardSlug, tenant, host, careerSite, careersUrl: url.startsWith("https://") ? url.slice(0, 500) : null, origin: `${INVENTORY_ORIGIN_PREFIX}${provider}`, originRef: (boardSlug ?? `${tenant}/${careerSite}`).slice(0, 200) } };
}

export const candidateKey = (c: CandidateInput) => [c.provider, c.boardSlug, c.tenant, c.host, c.careerSite].map((x) => (x ?? "").toLowerCase()).join("|");

export interface FileReport { file: string; provider: string; supported: boolean; downloaded: boolean; notModified: boolean; bytes: number; sha256: string | null; rows: number; candidates: number; invalid: number; invalidReasons: Record<string, number>; duplicates: number; slugMismatches: number; error?: string }
export interface InventoryResult {
  listing: InventoryListing;
  files: FileReport[];
  candidates: CandidateInput[]; // deduplicated, ordered round-robin across platforms
  totals: { filesListed: number; filesDownloaded: number; rows: number; candidates: number; invalid: number; duplicates: number; unsupportedRows: number; unsupportedByProvider: Record<string, number> };
  etags: Record<string, string>;
}

/** Download + parse + map + dedupe. `provider` restricts to one platform file; `etags` makes the run incremental (304 → skipped). */
export async function collectInventory(o: { provider?: string | null; token?: string | null; fetchText?: FetchText; etags?: Record<string, string>; listing?: InventoryListing } = {}): Promise<InventoryResult> {
  const fetchText = o.fetchText ?? defaultFetchText;
  const listing = o.listing ?? (await listInventoryFiles({ token: o.token, fetchText }));
  const want = o.provider?.toLowerCase();
  const picked = listing.files.filter((f) => !want || f.provider === want);
  const reports: FileReport[] = [];
  const perProvider: CandidateInput[][] = [];
  const seen = new Set<string>();
  const etags: Record<string, string> = { ...(o.etags ?? {}) };
  const unsupportedByProvider: Record<string, number> = {};
  const totals = { filesListed: listing.files.length, filesDownloaded: 0, rows: 0, candidates: 0, invalid: 0, duplicates: 0, unsupportedRows: 0, unsupportedByProvider };
  for (const f of picked) {
    const supported = isProviderId(f.provider);
    const rep: FileReport = { file: f.name, provider: f.provider, supported, downloaded: false, notModified: false, bytes: 0, sha256: null, rows: 0, candidates: 0, invalid: 0, invalidReasons: {}, duplicates: 0, slugMismatches: 0 };
    reports.push(rep);
    try {
      const r = await fetchText(f.url, { Accept: "text/csv, text/plain" }, { etag: o.etags?.[f.name] ?? null });
      if (r.notModified) { rep.notModified = true; continue; }
      rep.downloaded = true; totals.filesDownloaded++;
      rep.bytes = Buffer.byteLength(r.text);
      rep.sha256 = crypto.createHash("sha256").update(r.text).digest("hex");
      if (r.etag) etags[f.name] = r.etag;
      const { rows } = parseCsv(r.text);
      rep.rows = rows.length; totals.rows += rows.length;
      if (!supported) { totals.unsupportedRows += rows.length; unsupportedByProvider[f.provider] = rows.length; continue; }
      const list: CandidateInput[] = [];
      for (const row of rows) {
        const m = mapInventoryRow(f.provider, row);
        if (m.kind === "invalid") { rep.invalid++; totals.invalid++; rep.invalidReasons[m.reason] = (rep.invalidReasons[m.reason] ?? 0) + 1; continue; }
        if (m.kind === "unsupported") continue;
        if (m.slugMismatch) rep.slugMismatches++;
        const key = candidateKey(m.candidate);
        if (seen.has(key)) { rep.duplicates++; totals.duplicates++; continue; }
        seen.add(key);
        list.push(m.candidate);
      }
      rep.candidates = list.length; totals.candidates += list.length;
      perProvider.push(list);
    } catch (e) {
      rep.error = (e as Error).message.slice(0, 160);
    }
  }
  // Round-robin across platforms (India-native platforms first) so any --limit sample covers every provider, not just the first file.
  perProvider.sort((a, b) => (PROVIDER_PRIORITY[b[0]?.provider as ProviderId] ?? 0) - (PROVIDER_PRIORITY[a[0]?.provider as ProviderId] ?? 0));
  const ordered: CandidateInput[] = [];
  for (let i = 0, more = true; more; i++) {
    more = false;
    for (const l of perProvider) if (i < l.length) { ordered.push(l[i]!); more = true; }
  }
  return { listing, files: reports, candidates: ordered, totals, etags };
}
