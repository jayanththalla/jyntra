import { httpJson } from "../http";
import { finalizeJob } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { arr, emptyResult, need, notModifiedResult, rec, s, SLUG, salary, validateByFetching } from "./util";

export const ashby: JobProvider = {
  provider: "ashby",
  validateSource: (src) => validateByFetching(ashby.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const slug = need(src.boardSlug, SLUG, "Ashby board name");
    const api = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
    const r = await httpJson<unknown>(api, { etag: src.etag, lastModified: src.lastModified, timeoutMs: o.timeoutMs, signal: o.signal });
    if (r.notModified) return notModifiedResult(r.etag, r.lastModified);
    const body = rec(r.data);
    if (!Array.isArray(body.jobs)) throw new IngestError("unexpected Ashby response (no jobs array)", "bad_response", r.status);
    const out = emptyResult({ httpStatus: r.status, etag: r.etag, lastModified: r.lastModified, pages: 1 });
    for (const j of arr(body.jobs)) {
      if (j.isListed === false) continue; // unlisted postings are not public
      const postal = rec(rec(j.address).postalAddress);
      const comps = arr(rec(j.compensation).summaryComponents).find((c) => /salary/i.test(String(c.compensationType)));
      const range = salary(comps?.minValue, comps?.maxValue);
      const wt = s(j.workplaceType)?.toLowerCase();
      const job = finalizeJob(src.companySlug, "ashby", `https://jobs.ashbyhq.com/${slug}`, {
        externalJobId: j.id,
        title: j.title,
        descriptionText: s(j.descriptionPlain),
        descriptionHtml: s(j.descriptionPlain) ? null : s(j.descriptionHtml),
        locationTexts: [s(j.location), ...arr(j.secondaryLocations).map((x) => s(x.location)), [s(postal.addressLocality), s(postal.addressRegion), s(postal.addressCountry)].filter(Boolean).join(", ") || null],
        workplaceType: wt === "remote" ? "remote" : wt === "hybrid" ? "hybrid" : wt === "onsite" ? "onsite" : "unknown",
        remoteFlag: j.isRemote === true,
        employmentType: s(j.employmentType),
        salaryMin: range.min, salaryMax: range.max, salaryCurrency: s(comps?.currencyCode), salaryPeriod: s(comps?.interval),
        postedAt: j.publishedAt,
        applyUrl: s(j.applyUrl) ?? s(j.jobUrl),
        sourceUrl: s(j.jobUrl),
        metadata: { department: s(j.department), team: s(j.team) },
      });
      if (job) out.jobs.push(job);
      else out.skipped++;
    }
    return out;
  },
};
