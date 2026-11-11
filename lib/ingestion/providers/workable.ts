import { httpJson } from "../http";
import { finalizeJob } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { arr, emptyResult, need, rec, s, SLUG, validateByFetching } from "./util";

export const workable: JobProvider = {
  provider: "workable",
  validateSource: (src) => validateByFetching(workable.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const slug = need(src.boardSlug, SLUG, "Workable account");
    const r = await httpJson<unknown>(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`, { timeoutMs: o.timeoutMs, signal: o.signal });
    const body = rec(r.data);
    if (!Array.isArray(body.jobs)) throw new IngestError("unexpected Workable response (no jobs array)", "bad_response", r.status);
    const out = emptyResult({ httpStatus: r.status, pages: 1 });
    for (const j of arr(body.jobs)) {
      const locs = arr(j.locations).map((l) => [s(l.city), s(l.region), s(l.country)].filter(Boolean).join(", "));
      const job = finalizeJob(src.companySlug, "workable", `https://apply.workable.com/${slug}`, {
        externalJobId: j.shortcode,
        title: j.title,
        descriptionHtml: s(j.description),
        locationTexts: locs.length ? locs : [[s(j.city), s(j.state), s(j.country)].filter(Boolean).join(", ") || null],
        workplaceType: j.telecommuting === true ? "remote" : "unknown",
        employmentType: s(j.employment_type),
        postedAt: j.published_on ?? j.created_at,
        applyUrl: s(j.application_url) ?? s(j.url),
        sourceUrl: s(j.url),
        metadata: { department: s(j.department) },
      });
      if (job) out.jobs.push(job);
      else out.skipped++;
    }
    return out;
  },
};
