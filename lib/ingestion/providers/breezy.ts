import { httpJson } from "../http";
import { finalizeJob } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { arr, emptyResult, HOST_LABEL, need, rec, s, validateByFetching } from "./util";

function label(p: Record<string, any>): string {
  if (s(p.name)) return p.is_remote ? `${p.name}, Remote` : String(p.name);
  const parts = [s(p.city), s(rec(p.state).name), s(rec(p.country).name)].filter(Boolean);
  if (p.is_remote) parts.push("Remote");
  return parts.join(", ");
}

export const breezy: JobProvider = {
  provider: "breezy",
  validateSource: (src) => validateByFetching(breezy.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const sub = need(src.boardSlug, HOST_LABEL, "Breezy subdomain");
    const r = await httpJson<unknown>(`https://${sub}.breezy.hr/json`, { timeoutMs: o.timeoutMs, signal: o.signal });
    if (!Array.isArray(r.data)) throw new IngestError("unexpected Breezy response (not an array)", "bad_response", r.status);
    const out = emptyResult({ httpStatus: r.status, pages: 1 });
    for (const p of arr(r.data)) {
      const places = arr(p.locations).length ? arr(p.locations) : p.location ? [p.location] : [];
      const id = s(p.id) ?? s(p.friendly_id);
      const url = s(p.url) ?? (id ? `https://${sub}.breezy.hr/p/${s(p.friendly_id) ?? id}` : null);
      const job = finalizeJob(src.companySlug, "breezy", `https://${sub}.breezy.hr`, {
        externalJobId: id,
        title: p.name, // Breezy calls the title `name`
        locationTexts: places.map(label),
        employmentType: s(rec(p.type).name),
        postedAt: p.published_date,
        applyUrl: url,
        sourceUrl: url,
        metadata: { department: s(rec(p.department).name ?? p.department), salary: s(p.salary) },
      });
      if (job) out.jobs.push(job);
      else out.skipped++;
    }
    return out;
  },
};
