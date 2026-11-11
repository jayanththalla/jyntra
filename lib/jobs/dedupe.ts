// Cross-source job matching: the same role at the same company can arrive from two providers
// with different URLs. Two jobs are "the same" when the canonical URL matches, or when the title and
// location (when both are known) match after normalisation.
import { canonicalUrl } from "@/lib/url";

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/\((.*?)\)/g, " $1 ")
    .replace(/\b(remote|hybrid|on-?site|full[- ]?time|part[- ]?time)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface JobKey {
  url: string;
  title: string;
  location?: string | null;
}

export function isSameJob(a: JobKey, b: JobKey): boolean {
  const ua = canonicalUrl(a.url);
  const ub = canonicalUrl(b.url);
  if (ua && ub && ua === ub) return true;
  if (norm(a.title) !== norm(b.title) || !norm(a.title)) return false;
  const la = norm(a.location);
  const lb = norm(b.location);
  // Unknown location on either side is NOT evidence of a match: only merge when both agree.
  return !!la && la === lb;
}
