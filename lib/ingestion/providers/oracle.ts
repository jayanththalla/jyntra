// Oracle Recruiting Cloud (Oracle HCM "Candidate Experience"). Public REST resource used by the career-site front end; no credentials.
// Adapted from the response shape handled by smresponsibilities/jobscraper_hourly (MIT) — see THIRD_PARTY_NOTICES.md.
//
// The tenant, the regional pod ("fa", "fa.us2", "fa.ocs" …) and the site number are all opaque: JPMorgan is `jpmc`, not
// `jpmorgan`. They are taken from a real careers URL (inventory row, Common Crawl hit, admin entry) and NEVER guessed.
//   tenant -> source.tenant     host -> source.host (pod)     site -> source.careerSite
import { httpJson } from "../http";
import { finalizeJob } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { arr, emptyResult, need, rec, s, validateByFetching } from "./util";

export const ORACLE_TENANT = /^[a-z0-9][a-z0-9-]{0,60}$/i;
export const ORACLE_POD = /^fa(?:\.[a-z0-9-]{1,20}){0,2}$/i;
export const ORACLE_SITE = /^[A-Za-z0-9_]{1,40}$/;
const PAGE = 200;

export const oracleOrigin = (tenant: string, pod: string) => `https://${tenant}.${pod}.oraclecloud.com`;

export const oracle: JobProvider = {
  provider: "oracle",
  validateSource: (src) => validateByFetching(oracle.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const tenant = need(src.tenant, ORACLE_TENANT, "Oracle tenant");
    const pod = need(src.host, ORACLE_POD, "Oracle pod");
    const site = need(src.careerSite, ORACLE_SITE, "Oracle site number");
    const origin = oracleOrigin(tenant, pod);
    const out = emptyResult();
    const maxPages = o.maxPages ?? 10;
    for (let page = 0; page < maxPages; page++) {
      const url = `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${site},limit=${PAGE},offset=${page * PAGE}`;
      const r = await httpJson<unknown>(url, { timeoutMs: o.timeoutMs, signal: o.signal });
      const body = rec(r.data);
      if (!Array.isArray(body.items)) throw new IngestError("unexpected Oracle response (no items)", "bad_response", r.status);
      out.httpStatus = r.status;
      out.pages++;
      const first = rec(arr(body.items)[0]);
      const reqs = arr(first.requisitionList);
      const total = Number(first.TotalJobsCount ?? 0);
      for (const q of reqs) {
        const id = s(q.Id);
        const link = id ? `${origin}/hcmUI/CandidateExperience/en/sites/${site}/job/${encodeURIComponent(id)}` : null;
        const job = finalizeJob(src.companySlug, "oracle", `${origin}/hcmUI/CandidateExperience/en/sites/${site}`, {
          externalJobId: id,
          title: q.Title,
          descriptionText: s(q.ShortDescriptionStr),
          locationTexts: [s(q.PrimaryLocation)],
          postedAt: q.PostedDate,
          applyUrl: link, sourceUrl: link,
          metadata: { jobFamily: s(q.JobFamily) },
        });
        if (job) out.jobs.push(job);
        else out.skipped++;
      }
      if (reqs.length === 0) break;
      if (total > 0 ? (page + 1) * PAGE >= total : reqs.length < PAGE) return out;
      if (page === maxPages - 1) { out.complete = false; out.incompleteReason = `board has more than ${maxPages * PAGE} requisitions`; }
    }
    return out;
  },
};
