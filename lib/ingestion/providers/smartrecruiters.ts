import { httpJson } from "../http";
import { finalizeJob } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { arr, emptyResult, need, rec, s, SLUG, validateByFetching } from "./util";

const PAGE = 100;
const COUNTRY: Record<string, string> = { in: "India", us: "United States", gb: "United Kingdom", sg: "Singapore", ae: "United Arab Emirates", de: "Germany" };

export const smartrecruiters: JobProvider = {
  provider: "smartrecruiters",
  // SmartRecruiters answers 200 {totalFound:0} for companies that do not exist, so an empty board is not "valid".
  validateSource: (src) => validateByFetching(smartrecruiters.fetchJobs, src, true),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const id = need(src.boardSlug, SLUG, "SmartRecruiters company identifier");
    const out = emptyResult();
    const maxPages = o.maxPages ?? 20;
    for (let page = 0; page < maxPages; page++) {
      const api = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings?limit=${PAGE}&offset=${page * PAGE}`;
      const r = await httpJson<unknown>(api, { timeoutMs: o.timeoutMs, signal: o.signal });
      const body = rec(r.data);
      if (!Array.isArray(body.content)) throw new IngestError("unexpected SmartRecruiters response (no content array)", "bad_response", r.status);
      if (page === 0) out.httpStatus = r.status;
      out.pages++;
      for (const p of arr(body.content)) {
        const loc = rec(p.location);
        const place = s(loc.fullLocation) ?? [s(loc.city), s(loc.region), COUNTRY[String(loc.country).toLowerCase()] ?? s(loc.country)].filter(Boolean).join(", ");
        const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(id)}/${encodeURIComponent(String(p.id))}`;
        const job = finalizeJob(src.companySlug, "smartrecruiters", `https://jobs.smartrecruiters.com/${id}`, {
          externalJobId: p.id,
          title: p.name,
          locationTexts: [place || null],
          workplaceType: loc.remote === true ? "remote" : loc.hybrid === true ? "hybrid" : "unknown",
          employmentType: s(rec(p.typeOfEmployment).label),
          postedAt: p.releasedDate,
          applyUrl: url,
          sourceUrl: url,
          metadata: { experienceLevel: s(rec(p.experienceLevel).label), department: s(rec(p.department).label) },
        });
        if (job) out.jobs.push(job);
        else out.skipped++;
      }
      const total = Number(body.totalFound ?? 0);
      if (arr(body.content).length === 0 || (page + 1) * PAGE >= total) return out;
    }
    out.complete = false;
    out.incompleteReason = `stopped after ${maxPages} page(s)`;
    return out;
  },
};
