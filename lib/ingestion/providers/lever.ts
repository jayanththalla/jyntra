import { httpJson } from "../http";
import { finalizeJob } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { arr, emptyResult, need, notModifiedResult, rec, s, SLUG, salary, validateByFetching } from "./util";

const PAGE = 100;

export const lever: JobProvider = {
  provider: "lever",
  validateSource: (src) => validateByFetching(lever.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const slug = need(src.boardSlug, SLUG, "Lever site");
    const host = src.config.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
    const out = emptyResult();
    const maxPages = o.maxPages ?? 30;
    for (let page = 0; page < maxPages; page++) {
      const api = `https://${host}/v0/postings/${slug}?mode=json&skip=${page * PAGE}&limit=${PAGE}`;
      const r = await httpJson<unknown>(api, { etag: page === 0 ? src.etag : null, lastModified: page === 0 ? src.lastModified : null, timeoutMs: o.timeoutMs, signal: o.signal });
      if (r.notModified) return notModifiedResult(r.etag, r.lastModified);
      if (!Array.isArray(r.data)) throw new IngestError("unexpected Lever response (not an array)", "bad_response", r.status);
      if (page === 0) { out.etag = r.etag; out.lastModified = r.lastModified; out.httpStatus = r.status; }
      out.pages++;
      for (const j of r.data as Record<string, any>[]) {
        const cat = rec(j.categories);
        const sal = rec(j.salaryRange);
        const range = salary(sal.min, sal.max);
        const wp = s(j.workplaceType)?.toLowerCase();
        const job = finalizeJob(src.companySlug, "lever", `https://jobs.lever.co/${slug}`, {
          externalJobId: j.id,
          title: j.text,
          descriptionText: [s(j.descriptionPlain), ...arr(j.lists).map((l) => `${s(l.text) ?? ""}\n${s(l.content)?.replace(/<[^>]+>/g, " ") ?? ""}`), s(j.additionalPlain)].filter(Boolean).join("\n\n") || null,
          locationTexts: [s(cat.location), ...arr<string>(cat.allLocations)],
          workplaceType: wp === "remote" || wp === "hybrid" ? wp : wp === "on-site" || wp === "onsite" ? "onsite" : "unknown",
          employmentType: s(cat.commitment),
          salaryMin: range.min, salaryMax: range.max, salaryCurrency: s(sal.currency), salaryPeriod: s(sal.interval),
          postedAt: j.createdAt,
          applyUrl: s(j.applyUrl) ?? s(j.hostedUrl),
          sourceUrl: s(j.hostedUrl),
          metadata: { team: s(cat.team), department: s(cat.department) },
        });
        if (job) out.jobs.push(job);
        else out.skipped++;
      }
      if ((r.data as unknown[]).length < PAGE) return out;
    }
    out.complete = false;
    out.incompleteReason = `stopped after ${maxPages} page(s)`;
    return out;
  },
};
