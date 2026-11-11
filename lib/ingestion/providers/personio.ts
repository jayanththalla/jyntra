// Personio public XML feed: https://{subdomain}.jobs.personio.de/xml. No credentials.
import { httpRequest } from "../http";
import { finalizeJob } from "../normalize";
import { IngestError, type FetchOptions, type JobProvider, type JobSource } from "../types";
import { emptyResult, HOST_LABEL, need, notModifiedResult, validateByFetching } from "./util";

const unwrap = (v: string) => v.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
function tags(block: string, name: string): string[] {
  return [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g"))].map((m) => unwrap(m[1]!)).filter(Boolean);
}
const one = (block: string, name: string) => tags(block, name)[0] ?? null;

/** "2-5" → 2..5, "lt-1" → 0..1, "gt-15" → 15.. */
export function personioYears(v: string | null): { min: number | null; max: number | null } {
  if (!v) return { min: null, max: null };
  let m = /^(\d+)-(\d+)$/.exec(v);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = /^lt-(\d+)$/.exec(v);
  if (m) return { min: 0, max: Number(m[1]) };
  m = /^gt-(\d+)$/.exec(v);
  if (m) return { min: Number(m[1]), max: null };
  return { min: null, max: null };
}

export const personio: JobProvider = {
  provider: "personio",
  validateSource: (src) => validateByFetching(personio.fetchJobs, src),
  async fetchJobs(src: JobSource, o: FetchOptions = {}) {
    const sub = need(src.boardSlug, HOST_LABEL, "Personio subdomain");
    const r = await httpRequest(`https://${sub}.jobs.personio.de/xml`, { etag: src.etag, lastModified: src.lastModified, timeoutMs: o.timeoutMs, signal: o.signal, headers: { Accept: "application/xml, text/xml" } });
    if (r.notModified) return notModifiedResult(r.etag, r.lastModified);
    // A tenant with no board redirects to the marketing site; only the real feed has this root element.
    if (!/<workzag-jobs[\s>]/.test(r.text)) throw new IngestError("response is not a Personio job feed", "bad_response", r.status);
    const out = emptyResult({ httpStatus: r.status, etag: r.etag, lastModified: r.lastModified, pages: 1 });
    for (const m of r.text.matchAll(/<position>([\s\S]*?)<\/position>/g)) {
      const b = m[1]!;
      const id = one(b, "id");
      const desc = [...b.matchAll(/<jobDescription>([\s\S]*?)<\/jobDescription>/g)].map((d) => `${one(d[1]!, "name") ?? ""}\n${one(d[1]!, "value") ?? ""}`).join("\n");
      const yrs = personioYears(one(b, "yearsOfExperience"));
      const url = id ? `https://${sub}.jobs.personio.de/job/${encodeURIComponent(id)}` : null;
      const offices = [...tags(b, "office"), ...tags(b, "additionalOffices").flatMap((a) => tags(`<x>${a}</x>`, "office"))].map((x) => x.replace(/_/g, " "));
      const job = finalizeJob(src.companySlug, "personio", `https://${sub}.jobs.personio.de`, {
        externalJobId: id,
        title: one(b, "name"),
        descriptionHtml: desc || null,
        locationTexts: [...new Set(offices)],
        employmentType: [one(b, "schedule"), one(b, "employmentType")].filter(Boolean).join(" ") || null,
        experienceMin: yrs.min, experienceMax: yrs.max,
        postedAt: one(b, "createdAt"),
        applyUrl: url, sourceUrl: url,
        metadata: { department: one(b, "department"), seniority: one(b, "seniority") },
      });
      if (job) out.jobs.push(job);
      else out.skipped++;
    }
    return out;
  },
};
