// Pure helpers and types for the arena data. Safe to import from client components (no fs).
export interface ArenaJob {
  id: string;
  title: string;
  location: string | null;
  mode: "remote" | "hybrid" | "onsite" | "unknown";
  type: string;
  posted: string | null; // YYYY-MM-DD, null when unknown or in the future (a source data error)
  experience: string | null;
  salary: string | null;
  family: string;
  fresher: boolean;
  /** Direct application URL from the source. Null when the source did not supply a valid one. */
  applicationUrl: string | null;
  /** Alias of applicationUrl (legacy name used by older cards). */
  applyUrl: string | null;
  jobDetailUrl: string | null;
  seniority: string | null;
  summary: string;
  stale?: boolean;
}
export const MODE_LABEL: Record<ArenaJob["mode"], string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unknown: "Not stated" };
const WORDS: Record<string, string> = { sde: "software", ml: "ML", ai: "AI", qa: "QA", hr: "HR", it: "IT", fpa: "FP&A", ux: "UX", ui: "UI", sdr: "SDR", devops: "DevOps", sre: "SRE", bi: "BI", ea: "EA" };
export const familyLabel = (f: string) => {
  const t = f.split("_").map((w) => WORDS[w] ?? w).join(" ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Bucket "3+ years", "3-5 years", "Fresher friendly"… into the five bands people think in. */
export function experienceBand(exp: string | null, fresher: boolean): string {
  if (fresher && (!exp || /fresher|0\s*-\s*[12]/i.test(exp))) return "Fresher";
  if (!exp) return "Not stated";
  if (/fresher/i.test(exp)) return "Fresher";
  const min = Number((exp.match(/\d+/) ?? [])[0]);
  if (!Number.isFinite(min)) return "Not stated";
  return min <= 1 ? "0–1 yrs" : min <= 3 ? "2–3 yrs" : min <= 6 ? "4–6 yrs" : min <= 9 ? "7–9 yrs" : "10+ yrs";
}
export const EXPERIENCE_ORDER = ["Fresher", "0–1 yrs", "2–3 yrs", "4–6 yrs", "7–9 yrs", "10+ yrs", "Not stated"];


/** "22 Oct 2026". Fixed locale and UTC so server and browser render the same text. */
export function fmtDate(iso: string | null): string {
  if (!iso) return "Date not listed";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
/** Whole days between two YYYY-MM-DD dates (today - posted). */
export function daysBetween(today: string, iso: string): number {
  return Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(iso + "T00:00:00Z")) / 86_400_000);
}
export function ageLabel(today: string, iso: string | null): string {
  if (!iso) return "Date not listed";
  const d = daysBetween(today, iso);
  return d <= 0 ? "Today" : d === 1 ? "Yesterday" : d < 30 ? `${d} days ago` : fmtDate(iso);
}

export interface CompanyCard { slug: string; name: string; count: number; fresher: number; recent: number; remote: number; families: string[]; latest: string | null; location: string | null; logoSrc?: string | null; city?: string | null }

/** Extract a short area name from a full location string like "Bangalore South, Karnataka, India" → "Bangalore South". */
export function shortLocation(loc: string | null): string | null {
  if (!loc) return null;
  // Take the first segment before a comma, strip state / country / "India"
  const first = loc.split(",")[0].trim();
  if (!first || /^india$/i.test(first)) return null;
  return first;
}
