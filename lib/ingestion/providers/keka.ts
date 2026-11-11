import { httpJson } from "../http";
import { finalizeJob, parseExperience } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { arr, emptyResult, HOST_LABEL, need, s, validateByFetching } from "./util";

export const keka: JobProvider = {
  provider: "keka",
  validateSource: (src) => validateByFetching(keka.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const sub = need(src.boardSlug, HOST_LABEL, "Keka subdomain");
    const portal = src.careerSite && /^[A-Za-z0-9_-]{1,40}$/.test(src.careerSite) ? src.careerSite : "default";
    const r = await httpJson<unknown>(`https://${sub}.keka.com/careers/api/jobs/${portal}/active`, { timeoutMs: o.timeoutMs, signal: o.signal });
    if (!Array.isArray(r.data)) throw new IngestError("unexpected Keka response (not an array)", "bad_response", r.status);
    const out = emptyResult({ httpStatus: r.status, pages: 1 });
    for (const j of arr(r.data)) {
      const url = `https://${sub}.keka.com/careers/jobdetails/${encodeURIComponent(String(j.id))}`;
      const job = finalizeJob(src.companySlug, "keka", `https://${sub}.keka.com/careers`, {
        externalJobId: j.id,
        title: j.title,
        descriptionHtml: s(j.description) ?? s(j.excerpt),
        locationTexts: arr(j.jobLocations).map((l) => [s(l.city), s(l.state), s(l.countryName)].filter(Boolean).join(", ")),
        postedAt: j.publishedOn,
        applyUrl: url,
        sourceUrl: url,
        metadata: { department: s(j.departmentName), experienceText: s(j.experience) },
      });
      if (job) {
        if (job.experienceMin === null && job.experienceMax === null && s(j.experience)) {
          const e = parseExperience(String(j.experience).replace(/(\d)\s*$/, "$1 years"));
          job.experienceMin = e.min;
          job.experienceMax = e.max;
        }
        out.jobs.push(job);
      } else out.skipped++;
    }
    return out;
  },
};
