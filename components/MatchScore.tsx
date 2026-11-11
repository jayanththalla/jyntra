import type { JobMatch } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

export const MATCH_LABEL: Record<JobMatch["relevance"], string> = {
  strong: "Great match",
  potential: "Good match",
  low: "Weak match",
  not_relevant: "Not your role",
};

const VARIANT: Record<JobMatch["relevance"], "success" | "warning" | "secondary"> = {
  strong: "success",
  potential: "warning",
  low: "secondary",
  not_relevant: "secondary",
};

/** `showScore={false}` inside a startup card, whose corner already shows the percentage. */
export function MatchBadge({ match, showScore = true }: { match: JobMatch; showScore?: boolean }) {
  return (
    <Badge variant={VARIANT[match.relevance]} className={match.relevance === "not_relevant" ? "opacity-70" : undefined}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {MATCH_LABEL[match.relevance]}
      {showScore && match.relevance !== "not_relevant" && <span className="font-normal tabular-nums opacity-75">{match.match_score}%</span>}
    </Badge>
  );
}

/** The matcher's cap reasons ("Marked low relevance: …") reworded for students. */
function friendlyCapReason(r: string) {
  return r.replace(/^Marked low relevance:\s*/i, "Ranked lower because of: ").replace(/^Marked potential \(not strong\):\s*/i, "Good, not great: ");
}

/** The whole match in one sentence: role · skills · location · experience (and why it was marked down). */
export function matchSummary(match: JobMatch): string {
  const r = match.role_match;
  const role = r.level === "strong" ? `${r.matched_role ?? "Your target"} role` : r.level === "partial" ? "Tech role, not one of your targets" : "Not one of your target roles";
  const listed = match.matched_skills.length + match.missing_skills.length;
  const missing = match.missing_skills.slice(0, 2);
  const skills = listed ? `you have ${match.matched_skills.length} of ${listed} skills${missing.length ? ` (missing ${missing.join(", ")}${match.missing_skills.length > 2 ? "…" : ""})` : ""}` : null;
  const parts = [role, skills, match.location_match.label, match.experience_match.label].filter(Boolean);
  return (match.cap_reason ? `${friendlyCapReason(match.cap_reason)}. ` : "") + parts.join(" · ");
}
