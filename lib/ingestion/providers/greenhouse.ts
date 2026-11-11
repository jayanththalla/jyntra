import { httpJson } from "../http";
import { finalizeJob } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { arr, emptyResult, need, notModifiedResult, rec, s, SLUG, validateByFetching } from "./util";

export const greenhouse: JobProvider = {
  provider: "greenhouse",
  validateSource: (src) => validateByFetching(greenhouse.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const slug = need(src.boardSlug, SLUG, "Greenhouse board token");
    const api = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    const r = await httpJson<{ jobs?: unknown; meta?: { total?: number } }>(api, { etag: src.etag, lastModified: src.lastModified, timeoutMs: o.timeoutMs, signal: o.signal, maxBytes: 40 * 1024 * 1024 });
    if (r.notModified) return notModifiedResult(r.etag, r.lastModified);
    const body = rec(r.data);
    if (!Array.isArray(body.jobs)) throw new IngestError("unexpected Greenhouse response (no jobs array)", "bad_response", r.status);
    const out = emptyResult({ httpStatus: r.status, etag: r.etag, lastModified: r.lastModified, pages: 1 });
    for (const j of arr(body.jobs)) {
      const offices = arr(j.offices).map((x) => s(x.location) ?? s(x.name));
      const job = finalizeJob(src.companySlug, "greenhouse", `https://boards.greenhouse.io/${slug}`, {
        externalJobId: j.id,
        title: j.title,
        descriptionHtml: s(j.content),
        locationTexts: [s(rec(j.location).name), ...(rec(j.location).name ? [] : offices)],
        // `updated_at` is the last edit, not the publication date: only first_published counts.
        postedAt: j.first_published,
        applyUrl: s(j.absolute_url),
        sourceUrl: s(j.absolute_url),
        metadata: { departments: arr(j.departments).map((d) => s(d.name)).filter(Boolean), requisitionId: s(j.requisition_id) },
      });
      if (job) out.jobs.push(job);
      else out.skipped++;
    }
    const total = body.meta?.total;
    if (typeof total === "number" && total > arr(body.jobs).length) {
      out.complete = false;
      out.incompleteReason = `board reports ${total} jobs but returned ${arr(body.jobs).length}`;
    }
    return out;
  },
};
