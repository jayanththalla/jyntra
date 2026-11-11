import type { JobResult } from "@/lib/types";
import type { CompanyJobRecord } from "./adapter";
import { experienceLabel } from "./adapter";

const BASE = process.env.BLRARENA_BASE_URL || "https://www.blrstartuparena.com";

/** Discovery-layer shape. applicationUrl is copied onto applyUrl; a missing link stays null. */
export function companyJobToJobResult(j: CompanyJobRecord): JobResult {
  const page = `${BASE}/companies/${j.companySlug}`;
  const listing = j.jobDetailUrl ?? (j.externalJobId ? `${page}?job=${j.externalJobId}` : page);
  const salary =
    j.salaryEstimated === true || (j.salaryMin === null && j.salaryMax === null)
      ? null
      : `₹${[j.salaryMin, j.salaryMax].filter((x) => x !== null).join("–")} LPA`;
  return {
    title: j.title,
    url: listing,
    applyUrl: j.applicationUrl,
    location: j.location,
    remote: j.workMode === "remote" ? "yes" : j.workMode === "onsite" ? "no" : "unknown",
    remoteScope: null,
    employmentType: j.employmentType,
    postedDate: j.postedAt ? j.postedAt.slice(0, 10) : null,
    minExperience: experienceLabel(j),
    salary,
    skills: j.roleFamily ? [j.roleFamily.replace(/_/g, " ")] : [],
    description: j.description,
    source: j.source,
    sourceUrl: page,
    externalId: j.externalJobId ? `${j.source}:${j.companySlug}:${j.externalJobId}` : null,
    verification: j.source === "blrarena" ? "source_api" : "ats_api",
  };
}
