// Explicit source constraints in the question: "only use GitHub", "from my resume only", "use my leetcode data".
// "only"/"just"/"exclusively" RESTRICTS evidence; "use/based on my resume" PRIORITISES it. Deterministic.
export interface SourceConstraint { only: boolean; providers: string[]; docTypes: string[]; label: string }

const SOURCES: { re: RegExp; providers: string[]; docTypes: string[]; label: string }[] = [
  { re: /\bgit ?hub\b|\brepos?\b|\brepositor(y|ies)\b/i, providers: ["github"], docTypes: [], label: "GitHub" },
  { re: /\bresume\b|\bcv\b/i, providers: [], docTypes: ["resume"], label: "your resume" },
  { re: /\bleet ?code\b/i, providers: ["leetcode"], docTypes: [], label: "LeetCode" },
  { re: /\bcode ?forces\b/i, providers: ["codeforces"], docTypes: [], label: "Codeforces" },
  { re: /\blinked ?in\b/i, providers: [], docTypes: ["profile"], label: "your LinkedIn/profile text" },
];

export function parseSourceConstraint(q: string): SourceConstraint | null {
  const t = q.slice(0, 600);
  const only = /\b(only|just|exclusively|solely)\b[^.?!\n]{0,40}\b(use|using|from|in|on|with|based on|look at|check)\b|\b(use|using|from|in|based on)\b[^.?!\n]{0,40}\b(only|exclusively|solely)\b|\bonly\s+(my\s+)?(git ?hub|resume|cv|leet ?code|code ?forces|linked ?in)\b/i.test(t);
  const use = /\b(use|using|from|based on|according to|in|check)\b[^.?!\n]{0,30}\b(my\s+)?(git ?hub|resume|cv|leet ?code|code ?forces|linked ?in)\b/i.test(t);
  if (!only && !use) return null;
  const hits = SOURCES.filter((s) => s.re.test(t));
  if (!hits.length) return null;
  return { only, providers: hits.flatMap((h) => h.providers), docTypes: hits.flatMap((h) => h.docTypes), label: hits.map((h) => h.label).join(" and ") };
}
