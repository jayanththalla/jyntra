// Independent public ATS boards used only when the company-jobs endpoint is missing or incomplete.
// Official Greenhouse / Lever / Ashby job-board APIs. Never scrape a private portal.
import { fetchAtsJobs, findAtsRef, type AtsRef } from "@/sources/jobs/ats";
import type { CompanyJobRecord } from "./adapter";
import { applicationUrlOrNull } from "./urls";

export function atsRefFromText(text: string | null | undefined): AtsRef | null {
  if (!text) return null;
  return findAtsRef(text);
}

export async function jobsFromPublicAts(ref: AtsRef, slug: string, maxAgeHours = 12): Promise<CompanyJobRecord[]> {
  const { jobs } = await fetchAtsJobs(ref, `ats:${ref.vendor}`, maxAgeHours);
  return jobs
    .map((j): CompanyJobRecord | null => {
      if (!j.title) return null;
      return {
        externalJobId: j.externalId ?? null,
        title: j.title,
        normalizedTitle: null,
        seniority: null,
        workMode: j.remote === "yes" ? "remote" : "unknown",
        employmentType: j.employmentType ?? null,
        location: j.location ?? null,
        applicationUrl: applicationUrlOrNull(j.applyUrl ?? null),
        jobDetailUrl: applicationUrlOrNull(j.url),
        postedAt: j.postedDate ? new Date(j.postedDate).toISOString() : null,
        fresherFriendly: null,
        experienceMin: null,
        experienceMax: null,
        salaryMin: null,
        salaryMax: null,
        salaryEstimated: null,
        description: j.description ?? null,
        roleFamily: null,
        source: `ats:${ref.vendor}`,
        companySlug: slug,
      };
    })
    .filter((j): j is CompanyJobRecord => !!j);
}
