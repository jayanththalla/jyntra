// What kind of evidence backs a "this company is hiring" claim. Three different things that must not be blurred:
//   verified_opening  a specific role found in the company's own job-board data (ATS API) or its own JobPosting markup
//   listed_opening    a specific role listed by a third party (YC directory, Himalayas, a page we parsed); the company's own
//                     site was not used to confirm it
//   funding_signal    the company raised money recently; no open role was found. NOT evidence that anyone is hiring.
//   unverified_hiring a careers page or a directory flag exists, but no specific role was found
import type { JobView, StartupView } from "@/lib/types";

export type JobEvidenceKind = "verified_opening" | "listed_opening" | "unverified_opening";

export interface JobEvidence {
  kind: JobEvidenceKind;
  label: string;
  detail: string;
}

const VERIFICATION_NAME: Record<string, string> = {
  ats_api: "the company's own job board (ATS)",
  structured_data: "the company's own careers page (JobPosting markup)",
  source_api: "a job-listing API",
  source_page: "a page we read",
};

export function jobEvidence(j: Pick<JobView, "verification" | "source">): JobEvidence {
  const v = j.verification ?? "";
  if (v === "ats_api" || v === "structured_data") {
    return { kind: "verified_opening", label: "Verified opening", detail: `Found in ${VERIFICATION_NAME[v]}.` };
  }
  if (v === "source_api" || v === "source_page") {
    return { kind: "listed_opening", label: "Listed opening", detail: `Listed by ${j.source}, read from ${VERIFICATION_NAME[v]}. Not confirmed on the company's own site; open the original listing to check.` };
  }
  return { kind: "unverified_opening", label: "Unverified listing", detail: "The source did not say how this listing was confirmed. Open the original listing to check it is still open." };
}

export type CompanySignal = "open_roles" | "funding_signal" | "unverified_hiring" | "none";

export interface CompanyEvidence {
  signal: CompanySignal;
  label: string;
  detail: string;
  verified_roles: number;
  listed_roles: number;
}

type CompanyIn = Pick<StartupView, "jobs" | "last_funding_date" | "funding_round" | "last_funding_amount" | "careers_url" | "website" | "emails" | "funding_kind">;

export function companyEvidence(s: CompanyIn): CompanyEvidence {
  const verified = s.jobs.filter((j) => jobEvidence(j).kind === "verified_opening").length;
  const listed = s.jobs.length - verified;
  if (s.jobs.length > 0) {
    return {
      signal: "open_roles",
      label: verified ? `${verified} verified opening${verified === 1 ? "" : "s"}` : `${s.jobs.length} listed opening${s.jobs.length === 1 ? "" : "s"}`,
      detail: verified ? "Found in the company's own job-board data." : "Listed by a third-party source; open the original listing to confirm.",
      verified_roles: verified,
      listed_roles: listed,
    };
  }
  const funded = !!(s.last_funding_date || s.funding_round || s.last_funding_amount);
  if (funded) {
    const planned = s.funding_kind && s.funding_kind !== "confirmed";
    return {
      signal: "funding_signal",
      label: planned ? "Funding report (not confirmed), no open role found" : "Funding signal, no open role found",
      detail: "The company raised money, which sometimes leads to hiring. That is not evidence of an open role. A short message to the founder is the way in.",
      verified_roles: 0,
      listed_roles: 0,
    };
  }
  if (s.careers_url || (s.emails?.length ?? 0) > 0) {
    return { signal: "unverified_hiring", label: "Hiring unverified", detail: "A careers page or contact exists, but no specific role was found.", verified_roles: 0, listed_roles: 0 };
  }
  return { signal: "none", label: "No hiring information", detail: "No open role, careers page or contact is known.", verified_roles: 0, listed_roles: 0 };
}

// ---------- fit reasons and missing information (what the card shows under "Why this fits") ----------
import type { JobMatch } from "@/lib/types";

export interface FitReasons {
  reasons: string[];
  concerns: string[];
}

/** Plain-language reasons straight from the matcher's own fields. Nothing here is generated or guessed. */
export function fitReasons(m: JobMatch): FitReasons {
  const reasons: string[] = [];
  const concerns: string[] = [];
  if (m.role_match.level === "strong") reasons.push(m.role_match.note);
  else if (m.role_match.level === "partial") concerns.push(m.role_match.note);
  else concerns.push(m.role_match.note);
  if (m.matched_skills.length) reasons.push(`Skills you have: ${m.matched_skills.slice(0, 6).join(", ")}`);
  if (m.location_match.level === "match") reasons.push(m.location_match.label);
  else if (m.location_match.level === "none" || m.location_match.level === "partial") concerns.push(m.location_match.label);
  if (m.experience_match.level === "fits") reasons.push(m.experience_match.label);
  else if (m.experience_match.level === "too_senior" || m.experience_match.level === "stretch") concerns.push(m.experience_match.label);
  if (m.cap_reason) concerns.push(m.cap_reason.replace(/^Marked [^:]*:\s*/i, ""));
  return { reasons, concerns };
}

/** What we do NOT know about this listing. Shown on the card so a gap is never mistaken for a negative or a positive. */
export function missingInfo(j: Pick<JobView, "recency" | "location" | "remote" | "min_experience" | "salary" | "skills" | "apply_url" | "job_url" | "match">): string[] {
  const out: string[] = [];
  if (j.recency.date_basis === "none") out.push("Posting date: the source does not give one");
  if (!j.location && j.remote === "unknown") out.push("Location: not listed");
  if (!j.min_experience) out.push("Experience required: not stated");
  if (!j.salary) out.push("Salary: not stated");
  if (!j.skills.length) out.push("Skills: the listing names none, so the skills score is a weak signal");
  if (j.match.missing_skills.length) out.push(`Skills the listing wants that your profile lacks: ${j.match.missing_skills.slice(0, 5).join(", ")}`);
  return out;
}

/** "3 h ago" / "2 days ago" for last-check times. */
export function checkedAgo(iso: string | null, now = new Date()): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
