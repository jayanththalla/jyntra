// LeetCode connector: USER-PROVIDED data only.
// We deliberately do NOT call LeetCode's GraphQL or any undocumented endpoint: it has no public, permitted API for
// profile or submission data, and private submissions are never accessible. Supported inputs:
//   (a) a pasted export (JSON, CSV, or one problem per line) in config.importText
//   (b) a public profile URL in config.profileUrl, stored as a link only (nothing is imported from it)
import { SourceError, type Connector, type RawDoc, type SyncContext, type SyncResult } from "../types";

export interface LcProblem { title: string; difficulty: "Easy" | "Medium" | "Hard" | "Unknown"; topics: string[]; language?: string; slug?: string; date?: string }
export interface LcExport { problems: LcProblem[]; stats: Partial<Record<"Easy" | "Medium" | "Hard", number>> }

const MAX_IMPORT = 200_000;
const diff = (s: string | undefined): LcProblem["difficulty"] => (/^e/i.test(s ?? "") ? "Easy" : /^m/i.test(s ?? "") ? "Medium" : /^h/i.test(s ?? "") ? "Hard" : "Unknown");
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[;|,]/) : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);

export function validProfileUrl(u: string): string | null {
  const m = u.trim().match(/^https:\/\/(?:www\.)?leetcode\.com\/(?:u\/)?([A-Za-z0-9_-]{2,40})\/?$/i);
  return m ? `https://leetcode.com/u/${m[1]}/` : null;
}

export function parseLeetCodeExport(text: string): LcExport {
  const out: LcExport = { problems: [], stats: {} };
  const t = text.slice(0, MAX_IMPORT).trim();
  if (!t) return out;
  const push = (p: Partial<LcProblem> & { title?: string }) => {
    const title = (p.title ?? "").trim().slice(0, 160);
    if (title) out.problems.push({ title, difficulty: p.difficulty ?? "Unknown", topics: p.topics ?? [], language: p.language?.slice(0, 30), slug: p.slug?.slice(0, 120), date: p.date?.slice(0, 20) });
  };
  if (/^[\[{]/.test(t)) {
    try {
      const j = JSON.parse(t);
      const arr: any[] = Array.isArray(j) ? j : j.problems ?? j.solved ?? j.submissions ?? [];
      for (const p of arr) push({ title: p.title ?? p.name ?? p.questionTitle, difficulty: diff(p.difficulty), topics: list(p.topics ?? p.tags ?? p.topicTags), language: p.language ?? p.lang, slug: p.slug ?? p.titleSlug, date: p.date ?? p.timestamp });
      const s = j.stats ?? j.solvedStats ?? {};
      for (const k of ["Easy", "Medium", "Hard"] as const) if (Number.isFinite(Number(s[k] ?? s[k.toLowerCase()]))) out.stats[k] = Number(s[k] ?? s[k.toLowerCase()]);
      return out;
    } catch {
      /* fall through to text parsing */
    }
  }
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = /^title\s*,/i.test(lines[0] ?? "") ? lines[0].toLowerCase().split(",").map((c) => c.trim()) : null;
  for (const line of header ? lines.slice(1) : lines) {
    const stat = [...line.matchAll(/\b(easy|medium|hard)\b\s*[:=]?\s*(\d{1,5})\b/gi)];
    if (stat.length && !/[,|]/.test(line.replace(/\b(easy|medium|hard)\b\s*[:=]?\s*\d+/gi, "").trim().replace(/[\s,]/g, ""))) {
      for (const m of stat) out.stats[diff(m[1]) as "Easy"] = Number(m[2]);
      continue;
    }
    const cells = line.split(line.includes("\t") ? "\t" : line.includes("|") ? "|" : ",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (header) {
      const get = (k: string) => cells[header.indexOf(k)];
      push({ title: get("title"), difficulty: diff(get("difficulty")), topics: list(get("topics") ?? get("tags")), language: get("language"), slug: get("slug"), date: get("date") });
    } else {
      // "Two Sum | Easy | Array; Hash Table | Python"  or  "Two Sum - Easy"
      const dash = cells.length === 1 ? line.match(/^(.+?)\s+[-–]\s+(easy|medium|hard)\b\s*(.*)$/i) : null;
      if (dash) push({ title: dash[1], difficulty: diff(dash[2]), topics: list(dash[3]) });
      else push({ title: cells[0], difficulty: diff(cells[1]), topics: list(cells[2]), language: cells[3] });
    }
  }
  return out;
}

const count = <T,>(xs: T[], f: (x: T) => string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) for (const k of f(x)) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export const leetcodeConnector: Connector = {
  provider: "leetcode",
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const docs: RawDoc[] = [];
    const warnings: string[] = [];
    const rawUrl = typeof ctx.config.profileUrl === "string" ? ctx.config.profileUrl : "";
    const profileUrl = rawUrl ? validProfileUrl(rawUrl) : null;
    if (rawUrl && !profileUrl) throw new SourceError("invalid", "Use a public profile URL like https://leetcode.com/u/yourname.");
    const importText = typeof ctx.config.importText === "string" ? ctx.config.importText : "";
    if (importText.length > MAX_IMPORT) throw new SourceError("invalid", "The pasted export is larger than 200 KB.");
    if (!profileUrl && !importText.trim()) throw new SourceError("invalid", "Paste an export of your solved problems or provide a public profile URL.");

    if (profileUrl)
      docs.push({ externalId: "leetcode:profile-link", docType: "coding_stats", title: "LeetCode public profile link", url: profileUrl, content: `The candidate provided a public LeetCode profile link: ${profileUrl}. Public profile link provided; no data imported automatically. Problem statistics are only available if the candidate pastes an export.`, metadata: { technologies: [] } });
    if (importText.trim()) {
      const ex = parseLeetCodeExport(importText);
      if (!ex.problems.length && !Object.keys(ex.stats).length) warnings.push("Nothing recognisable was found in the pasted export.");
      const n = ex.problems.length;
      const byDiff = count(ex.problems, (p) => [p.difficulty]);
      const statLine = (["Easy", "Medium", "Hard"] as const).filter((k) => ex.stats[k] != null).map((k) => `${k} ${ex.stats[k]}`).join(", ");
      if (n || statLine)
        docs.push({
          externalId: "leetcode:summary", docType: "coding_stats", title: "LeetCode progress summary (user-provided export)", url: profileUrl,
          content: [`Source: user-provided export (not verified against LeetCode).`, statLine ? `Reported totals by difficulty: ${statLine}.` : "", n ? `Problems listed in the export: ${n}.` : "",
            byDiff.length ? `Listed by difficulty: ${byDiff.map(([k, v]) => `${k} ${v}`).join(", ")}.` : "", count(ex.problems, (p) => p.topics).length ? `Listed by topic: ${count(ex.problems, (p) => p.topics).slice(0, 15).map(([k, v]) => `${k} ${v}`).join(", ")}.` : "",
            count(ex.problems, (p) => (p.language ? [p.language] : [])).length ? `Languages: ${count(ex.problems, (p) => (p.language ? [p.language] : [])).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(", ")}.` : "",
            "Counts describe the supplied data, not proficiency."].filter(Boolean).join("\n"),
          metadata: { solved: n, stats: ex.stats, technologies: [] },
        });
      for (let i = 0; i < ex.problems.length; i += 100)
        docs.push({ externalId: `leetcode:problems:${i / 100}`, docType: "coding_stats", title: `LeetCode solved problems (user-provided export) ${i + 1}-${Math.min(n, i + 100)}`, url: profileUrl,
          content: ex.problems.slice(i, i + 100).map((p) => `- ${p.title} [${p.difficulty}]${p.topics.length ? ` topics: ${p.topics.join(", ")}` : ""}${p.language ? ` (${p.language})` : ""}${p.date ? ` ${p.date}` : ""}`).join("\n"), metadata: { technologies: [] } });
    }
    ctx.log(`leetcode: ${docs.length} documents (no network used)`);
    return { docs, complete: true, warnings };
  },
};
