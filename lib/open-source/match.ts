// "For you" ranking of beginner open-source projects against the user's OWN skills. Pure and explainable: a project is matched only when
// its language or description names a skill the user listed, and the reason shown is exactly that overlap. No overlap = no match.
export interface OssProject { repo: string; language: string | null; one_liner: string | null; repo_description: string | null; stars: number | null; issue_title: string; issue_url: string; beginner_issues: number }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
const ALIAS: Record<string, string[]> = { js: ["javascript"], javascript: ["js", "node", "nodejs"], ts: ["typescript"], typescript: ["ts"], py: ["python"], python: ["py"], golang: ["go"], go: ["golang"], cpp: ["c++"], "c++": ["cpp"], react: ["reactjs"], reactjs: ["react"], ml: ["machinelearning"], ai: ["llm"] };

export function matchProjects<T extends OssProject>(projects: T[], skills: string[], limit = 5): (T & { matchedOn: string[] })[] {
  const wanted = [...new Set(skills.map(norm).filter((s) => s.length >= 2))];
  if (!wanted.length) return [];
  const scored: (T & { matchedOn: string[]; _s: number })[] = [];
  for (const p of projects) {
    const lang = norm(p.language ?? "");
    const text = ` ${(p.one_liner ?? "")} ${(p.repo_description ?? "")} ${p.repo} `.toLowerCase();
    const matchedOn: string[] = [];
    let s = 0;
    for (const w of wanted) {
      const names = [w, ...(ALIAS[w] ?? [])];
      if (names.some((n) => lang === n)) { matchedOn.push(`language: ${p.language}`); s += 3; }
      else if (names.some((n) => n.length >= 3 && new RegExp(`\\b${n.replace(/[+.#]/g, "\\$&")}\\b`, "i").test(text))) { matchedOn.push(`mentions ${w}`); s += 1; }
    }
    if (s > 0) scored.push({ ...p, matchedOn: [...new Set(matchedOn)].slice(0, 3), _s: s + Math.min(1, Math.log10((p.stars ?? 1) + 1) / 5) + Math.min(0.5, p.beginner_issues / 20) });
  }
  return scored.sort((a, b) => b._s - a._s).slice(0, limit).map(({ _s, ...r }) => r as unknown as T & { matchedOn: string[] });
}
