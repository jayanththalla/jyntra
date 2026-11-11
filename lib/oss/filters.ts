// Open-source filters. Pure and client-safe. Difficulty is NOT a score: it is read from the issue's own labels and comment count,
// and the basis is always shown. With no evidence the issue is "not rated".

export type Difficulty = "easy" | "moderate" | "hard";
export const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: "Beginner-friendly", moderate: "Needs some context", hard: "Advanced" };

const HARD = /\b(hard|advanced|complex|difficult|expert|challenging|intermediate)\b/i;
const EASY = /good[\s-]first|beginner|\beasy\b|starter|newcomer|first[\s-]timers?|low[\s-]hanging/i;
const HELP = /help[\s-]wanted/i;

export function difficultyOf(p: { issue_labels: string[]; issue_comments: number }): { level: Difficulty; basis: string } | null {
  const labels = p.issue_labels;
  if (labels.some((l) => HARD.test(l))) return { level: "hard", basis: "Labelled as advanced or complex" };
  if (labels.some((l) => EASY.test(l))) {
    return p.issue_comments <= 3
      ? { level: "easy", basis: "Labelled for beginners, with little discussion so far" }
      : { level: "moderate", basis: "Labelled for beginners, but the thread is already long. Read it first" };
  }
  if (labels.some((l) => HELP.test(l))) return { level: "moderate", basis: "Maintainers want help; no beginner label" };
  return null;
}

export const FRESHNESS = [
  { value: "any", label: "Any activity", days: null },
  { value: "7", label: "Updated this week", days: 7 },
  { value: "30", label: "Updated this month", days: 30 },
  { value: "90", label: "Updated in 3 months", days: 90 },
] as const;

/** True when the issue was updated within `days`. An issue with no date never passes a date filter. */
export function updatedWithin(updatedAt: string | null, days: number | null, now = Date.now()): boolean {
  if (days == null) return true;
  if (!updatedAt) return false;
  return (now - new Date(updatedAt).getTime()) / 86_400_000 <= days;
}

/**
 * Programme collections. Membership is never typed in by hand: a project is in a collection only because GitHub itself says so
 * (the repo carries the programme's topic, or sits under the foundation's organisation). The match is evidence of tagging,
 * not proof the project is accepted this year: the programme's official site decides that.
 */
export interface Collection { id: string; label: string; scope: string; basis: string; url: string }
export const COLLECTIONS: Collection[] = [
  { id: "gssoc", label: "GSSoC", scope: "topic:gssoc", basis: "Repo is tagged with the gssoc topic on GitHub", url: "https://gssoc.girlscript.tech" },
  { id: "mlh", label: "MLH", scope: "topic:mlh-fellowship", basis: "Repo is tagged with the mlh-fellowship topic on GitHub", url: "https://fellowship.mlh.io" },
  { id: "cncf", label: "CNCF", scope: "topic:cncf", basis: "Repo is tagged with the cncf topic on GitHub", url: "https://www.cncf.io/projects/" },
  { id: "apache", label: "Apache", scope: "org:apache", basis: "Repo belongs to the apache organisation on GitHub", url: "https://projects.apache.org" },
];
export const COLLECTION_BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]));

/** GitHub repository search for one collection: active repos that keep beginner issues. */
export function collectionRepoQuery(c: Collection, pushedSince: string): string {
  return `${c.scope} good-first-issues:>=1 archived:false is:public pushed:>=${pushedSince}`;
}
