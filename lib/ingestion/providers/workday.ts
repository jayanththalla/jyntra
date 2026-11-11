// Workday career sites (…myworkdayjobs.com). Public CXS endpoint used by the career-site front end; no credentials.
import { httpJson } from "../http";
import { finalizeJob } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { arr, emptyResult, HOST_LABEL, need, rec, s, validateByFetching } from "./util";

const PAGE = 20; // Workday caps `limit` at 20
const SITE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const CLUSTER = /^wd\d{1,3}$/i;

/** "Posted 5 Days Ago" → a date (day precision). "30+ Days Ago" is a floor, not a date → null. */
export function parsePostedOn(label: string | undefined | null, now = Date.now()): string | null {
  if (!label) return null;
  const t = label.toLowerCase();
  if (t.includes("+")) return null;
  let days: number;
  if (t.includes("today")) days = 0;
  else if (t.includes("yesterday")) days = 1;
  else {
    const m = /(\d+)\s*days?\s*ago/.exec(t);
    if (!m) return null;
    days = Number(m[1]);
  }
  if (!Number.isFinite(days) || days < 0 || days > 3650) return null;
  return new Date(Date.UTC(...(ymd(now - days * 86_400_000)))).toISOString();
}
const ymd = (ms: number): [number, number, number] => { const d = new Date(ms); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; };

export const workday: JobProvider = {
  provider: "workday",
  validateSource: (src) => validateByFetching(workday.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const tenant = need(src.tenant, HOST_LABEL, "Workday tenant");
    const cluster = need(src.host, CLUSTER, "Workday cluster");
    const site = need(src.careerSite, SITE, "Workday career site");
    const base = `https://${tenant}.${cluster}.myworkdayjobs.com`;
    // Large employers list thousands of global roles; we only walk the India-scoped search(es). Configurable per source.
    const terms = (Array.isArray(src.config.searchTerms) ? (src.config.searchTerms as unknown[]) : ["India"]).map(String).filter((t) => t.length < 60).slice(0, 5);
    const out = emptyResult();
    const maxPages = o.maxPages ?? 75;
    const seen = new Map<string, true>();
    for (const term of terms) {
      let total = 0;
      let finished = false;
      for (let page = 0; page < maxPages; page++) {
        const r = await httpJson<unknown>(`${base}/wday/cxs/${tenant}/${site}/jobs`, { method: "POST", body: { appliedFacets: {}, limit: PAGE, offset: page * PAGE, searchText: term }, timeoutMs: o.timeoutMs, signal: o.signal });
        const body = rec(r.data);
        if (!Array.isArray(body.jobPostings)) throw new IngestError("unexpected Workday response (no jobPostings)", "bad_response", r.status);
        if (page === 0) { total = Number(body.total ?? 0); out.httpStatus = r.status; }
        out.pages++;
        const posts = arr(body.jobPostings);
        for (const p of posts) {
          const path = s(p.externalPath);
          const id = s(arr<string>(p.bulletFields)[0]) ?? path;
          if (!id || !path) { out.skipped++; continue; }
          if (seen.has(id)) continue;
          seen.set(id, true);
          const url = `${base}/en-US/${site}${path}`;
          const postedAt = parsePostedOn(s(p.postedOn));
          const job = finalizeJob(src.companySlug, "workday", `${base}/en-US/${site}`, {
            externalJobId: id,
            title: p.title,
            locationTexts: [s(p.locationsText)],
            postedAt,
            // The public posting page is the application entry point (it carries the Apply button).
            applyUrl: url, sourceUrl: url,
            metadata: { postedAtApprox: postedAt !== null, searchTerm: term, multiLocationPlaceholder: /\d+\s+locations?/i.test(String(p.locationsText ?? "")) },
          });
          if (job) out.jobs.push(job);
          else out.skipped++;
        }
        if (posts.length < PAGE || (total > 0 && (page + 1) * PAGE >= total)) { finished = true; break; }
      }
      if (!finished) {
        out.complete = false;
        out.incompleteReason = `search "${term}" exceeded ${maxPages} pages`;
      }
    }
    return out;
  },
};
