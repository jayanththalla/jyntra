// Eightfold AI career sites (`{tenant}.eightfold.ai`). The unauthenticated "pcsx" search endpoint used by the career-site front end.
// Adapted from the response shape handled by smresponsibilities/jobscraper_hourly (MIT) — see THIRD_PARTY_NOTICES.md.
//
// The endpoint needs the tenant's `domain` (e.g. "albemarle.com"). It comes from the inventory's `domain` column or an admin
// entry; it is NEVER guessed from the company name. Searches are scoped with location=India so large global boards stay cheap.
//   tenant label -> source.boardSlug     domain -> source.careerSite
import { httpJson } from "../http";
import { finalizeJob } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource, type WorkplaceType } from "../types";
import { arr, emptyResult, HOST_LABEL, need, rec, s, validateByFetching } from "./util";

export const EIGHTFOLD_DOMAIN = /^[a-z0-9][a-z0-9.-]{2,100}$/i;
const PAGE = 10; // the endpoint returns 10 per call and ignores `num`

export const eightfold: JobProvider = {
  provider: "eightfold",
  validateSource: (src) => validateByFetching(eightfold.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const label = need(src.boardSlug, HOST_LABEL, "Eightfold tenant");
    const domain = need(src.careerSite, EIGHTFOLD_DOMAIN, "Eightfold tenant domain");
    const origin = `https://${label}.eightfold.ai`;
    const out = emptyResult();
    const maxPages = o.maxPages ?? 100;
    for (let page = 0; page < maxPages; page++) {
      const r = await httpJson<unknown>(`${origin}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=India&start=${page * PAGE}&num=${PAGE}`, { timeoutMs: o.timeoutMs, signal: o.signal });
      const data = rec(rec(r.data).data);
      if (!Array.isArray(data.positions)) throw new IngestError("unexpected Eightfold response (no positions)", "bad_response", r.status);
      out.httpStatus = r.status;
      out.pages++;
      const positions = arr(data.positions);
      const total = Number(data.count ?? 0);
      for (const p of positions) {
        const where = arr<string>(p.standardizedLocations).length ? arr<string>(p.standardizedLocations) : arr<string>(p.locations);
        const flex = [s(p.workLocationOption), s(p.locationFlexibility)].filter(Boolean).join(" ");
        const wp: WorkplaceType = /remote/i.test(flex) ? "remote" : /hybrid/i.test(flex) ? "hybrid" : /on[- ]?site/i.test(flex) ? "onsite" : "unknown";
        const path = s(p.positionUrl);
        const link = path ? (path.startsWith("http") ? path : `${origin}${path.startsWith("/") ? "" : "/"}${path}`) : `${origin}/careers/job/${encodeURIComponent(String(p.id ?? ""))}`;
        const job = finalizeJob(src.companySlug, "eightfold", `${origin}/careers`, {
          externalJobId: s(p.displayJobId) ?? s(p.atsJobId) ?? s(p.id),
          title: p.name,
          descriptionText: s(p.job_description),
          locationTexts: where,
          workplaceType: wp,
          postedAt: p.postedTs,
          applyUrl: link, sourceUrl: link,
          metadata: { department: s(p.department) },
        });
        if (job) out.jobs.push(job);
        else out.skipped++;
      }
      if (positions.length < PAGE) return out;
      if (total > 0 && (page + 1) * PAGE >= total) return out;
      if (page === maxPages - 1) { out.complete = false; out.incompleteReason = `more than ${maxPages * PAGE} India positions`; }
    }
    return out;
  },
};
