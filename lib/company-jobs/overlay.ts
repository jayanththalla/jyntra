import type { ArenaJob } from "@/lib/arena/shared";
import { experienceLabel, type CompanyJobRecord } from "./adapter";
import { applicationUrlOrNull } from "./urls";

export function arenaJobFromRecord(j: CompanyJobRecord, stale = false): ArenaJob {
  const posted = j.postedAt && !Number.isNaN(Date.parse(j.postedAt)) ? j.postedAt.slice(0, 10) : null;
  const today = new Date().toISOString().slice(0, 10);
  const applicationUrl = applicationUrlOrNull(j.applicationUrl);
  return {
    id: j.externalJobId ?? `${j.companySlug}-${j.title}`,
    title: j.title,
    location: j.location,
    mode: j.workMode,
    type: j.employmentType ?? "unknown",
    posted: posted && posted <= today ? posted : posted,
    experience: experienceLabel(j),
    salary: j.salaryEstimated === true || (j.salaryMin === null && j.salaryMax === null) ? null : j.salaryMin !== null || j.salaryMax !== null ? `₹${[j.salaryMin, j.salaryMax].filter((x) => x !== null).join("–")} LPA` : null,
    family: j.roleFamily ?? "other",
    fresher: j.fresherFriendly === true,
    applicationUrl,
    applyUrl: applicationUrl,
    jobDetailUrl: j.jobDetailUrl,
    seniority: j.seniority,
    summary: j.description ?? "",
    stale,
  };
}

export function overlayArenaJobs(fileJobs: ArenaJob[], dbJobs: CompanyJobRecord[], stale = false): ArenaJob[] {
  if (!dbJobs.length) return fileJobs;
  const byId = new Map(dbJobs.filter((j) => j.externalJobId).map((j) => [j.externalJobId as string, j]));
  const used = new Set<string>();
  const out: ArenaJob[] = fileJobs.map((fj) => {
    const db = byId.get(fj.id);
    if (!db) return { ...fj, applyUrl: fj.applicationUrl, stale: fj.stale || stale };
    used.add(fj.id);
    const applicationUrl = db.applicationUrl ?? fj.applicationUrl;
    return {
      ...fj,
      title: db.title || fj.title,
      location: db.location ?? fj.location,
      mode: db.workMode !== "unknown" ? db.workMode : fj.mode,
      type: db.employmentType ?? fj.type,
      experience: experienceLabel(db) ?? fj.experience,
      family: db.roleFamily ?? fj.family,
      fresher: db.fresherFriendly === true || fj.fresher,
      applicationUrl,
      applyUrl: applicationUrl,
      jobDetailUrl: db.jobDetailUrl ?? fj.jobDetailUrl,
      seniority: db.seniority ?? fj.seniority,
      summary: db.description ?? fj.summary,
      stale,
    };
  });
  for (const j of dbJobs) {
    if (j.externalJobId && used.has(j.externalJobId)) continue;
    out.push(arenaJobFromRecord(j, stale));
  }
  return out;
}
