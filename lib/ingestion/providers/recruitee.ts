import { httpJson } from "../http";
import { finalizeJob } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { arr, emptyResult, HOST_LABEL, need, rec, s, validateByFetching } from "./util";

export const recruitee: JobProvider = {
  provider: "recruitee",
  validateSource: (src) => validateByFetching(recruitee.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const sub = need(src.boardSlug, HOST_LABEL, "Recruitee subdomain");
    const r = await httpJson<unknown>(`https://${sub}.recruitee.com/api/offers/`, { etag: src.etag, lastModified: src.lastModified, timeoutMs: o.timeoutMs, signal: o.signal });
    if (r.notModified) return { ...emptyResult({ notModified: true, httpStatus: 304, etag: r.etag, lastModified: r.lastModified }), complete: false, incompleteReason: "not modified" };
    const body = rec(r.data);
    if (!Array.isArray(body.offers)) throw new IngestError("unexpected Recruitee response (no offers array)", "bad_response", r.status);
    const out = emptyResult({ httpStatus: r.status, etag: r.etag, lastModified: r.lastModified, pages: 1 });
    for (const j of arr(body.offers)) {
      if (j.status && j.status !== "published") continue;
      const url = s(j.careers_url) ?? `https://${sub}.recruitee.com/o/${j.slug ?? j.id}`;
      const job = finalizeJob(src.companySlug, "recruitee", `https://${sub}.recruitee.com`, {
        externalJobId: j.id,
        title: j.title,
        descriptionHtml: [s(j.description), s(j.requirements)].filter(Boolean).join("\n") || null,
        locationTexts: [s(j.location) ?? ([s(j.city), s(j.country)].filter(Boolean).join(", ") || null)],
        workplaceType: j.remote === true ? "remote" : "unknown",
        employmentType: s(j.employment_type_code),
        postedAt: j.published_at ?? j.created_at,
        applyUrl: s(j.careers_apply_url) ?? url,
        sourceUrl: url,
        metadata: { department: s(j.department) },
      });
      if (job) out.jobs.push(job);
      else out.skipped++;
    }
    return out;
  },
};
