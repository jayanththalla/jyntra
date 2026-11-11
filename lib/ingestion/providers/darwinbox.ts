// Darwinbox's documented API needs a key from their integration team. The careers widget calls the unauthenticated
// endpoint below; many tenants sit behind Cloudflare and answer non-browser clients with 403 / a challenge. We do NOT
// work around that (no TLS spoofing, no headless browsers): a challenge marks the source `blocked` and the last good
// data stays. Tenants that answer plainly work.
import { httpRequest } from "../http";
import { finalizeJob, parseExperience } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { arr, emptyResult, HOST_LABEL, need, rec, s, validateByFetching } from "./util";

const PAGE = 50;
const flat = (v: unknown): string => (Array.isArray(v) ? v.filter(Boolean).join(", ") : typeof v === "string" ? v : "");

export const darwinbox: JobProvider = {
  provider: "darwinbox",
  validateSource: (src) => validateByFetching(darwinbox.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const sub = need(src.boardSlug, HOST_LABEL, "Darwinbox tenant");
    const companyId = src.careerSite && /^[A-Za-z0-9]{0,40}$/.test(src.careerSite) ? src.careerSite : "";
    const origin = `https://${sub}.darwinbox.in`;
    const out = emptyResult();
    const maxPages = o.maxPages ?? 12;
    let total = 0;
    for (let page = 1; page <= maxPages; page++) {
      const r = await httpRequest(`${origin}/ms/candidateapi/job/alljobs?companyId=${companyId}`, {
        method: "POST",
        headers: { Origin: origin, Referer: `${origin}/ms/candidate/careers` },
        body: { companyId, page, sort_option: "new", limit: PAGE },
        timeoutMs: o.timeoutMs, signal: o.signal,
      });
      let body: Record<string, any>;
      try { body = rec(JSON.parse(r.text)); } catch { throw new IngestError("response was not JSON", "invalid_json", r.status); }
      if (body.status !== "success" || !Array.isArray(body.data)) throw new IngestError("unexpected Darwinbox response", "bad_response", r.status);
      if (page === 1) { total = Number(body.job_counts ?? 0); out.httpStatus = r.status; }
      out.pages++;
      for (const j of arr(body.data)) {
        const where = [flat(j.officelocation_show_arr) || flat(j.officelocations_without_area) || flat(j.officelocation_arr), flat(j.country)].filter(Boolean).join(", ");
        const remote = j.is_remote && j.is_remote !== "0" && j.is_remote !== 0;
        const url = companyId ? `${origin}/ms/candidatev2/${companyId}/careers/jobDetails/${j.id}` : `${origin}/ms/candidate/careers/jobdetail/${j.id}`;
        const exp = typeof j.experience === "string" ? parseExperience(j.experience.replace(/(\d)\s*$/, "$1 years")) : { min: s(rec(j.experience).min) ? Number(rec(j.experience).min) : null, max: s(rec(j.experience).max) ? Number(rec(j.experience).max) : null };
        const job = finalizeJob(src.companySlug, "darwinbox", `${origin}/ms/candidate/careers`, {
          externalJobId: j.id,
          title: [j.designation_display_name, j.designation_title, j.designation_name, j.designation].find((v) => typeof v === "string" && v.trim()),
          descriptionHtml: s(j.jd),
          locationTexts: [where || null],
          workplaceType: remote ? "remote" : "unknown",
          employmentType: s(j.employee_type),
          experienceMin: exp.min, experienceMax: exp.max,
          postedAt: j.created_on,
          applyUrl: url, sourceUrl: url,
          metadata: { department: s(j.department_name) },
        });
        if (job) out.jobs.push(job);
        else out.skipped++;
      }
      if (arr(body.data).length === 0 || (total > 0 && page * PAGE >= total)) return out;
    }
    out.complete = false;
    out.incompleteReason = `stopped after ${maxPages} page(s)`;
    return out;
  },
};
