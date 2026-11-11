import type { ProviderId } from "./types";
/** Public careers URL of a board (for display and as the company's careers link). Built only from validated identifiers. */
export function atsBoardUrlFor(s: { provider: ProviderId; boardSlug: string | null; tenant: string | null; host: string | null; careerSite: string | null }): string {
  const b = s.boardSlug ?? "";
  switch (s.provider) {
    case "greenhouse": return `https://boards.greenhouse.io/${b}`;
    case "lever": return `https://jobs.lever.co/${b}`;
    case "ashby": return `https://jobs.ashbyhq.com/${b}`;
    case "smartrecruiters": return `https://jobs.smartrecruiters.com/${b}`;
    case "workable": return `https://apply.workable.com/${b}`;
    case "recruitee": return `https://${b}.recruitee.com`;
    case "personio": return `https://${b}.jobs.personio.de`;
    case "breezy": return `https://${b}.breezy.hr`;
    case "keka": return `https://${b}.keka.com/careers`;
    case "darwinbox": return `https://${b}.darwinbox.in/ms/candidate/careers`;
    case "oracle": return `https://${s.tenant}.${s.host}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/${s.careerSite}`;
    case "eightfold": return `https://${b}.eightfold.ai/careers`;
    case "workday": return `https://${s.tenant}.${s.host}.myworkdayjobs.com/en-US/${s.careerSite}`;
  }
}
