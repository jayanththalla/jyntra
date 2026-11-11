// Complete project inventory, built from the structured entity records (not from similarity search) and rendered without a model,
// so "list all my projects" always returns every distinct project exactly once, and the count is the real deduplicated count.
import type { Evidence } from "./answer";

export interface EntityLite { kind: string; name: string; level: string; data: any }
export interface InventoryItem { key: string; name: string; level: string; purpose: string; tech: string[]; refs: string[]; provider: string | null }

/** Two names are the same project only when they differ in case, spaces, hyphens, underscores or dots. No fuzzy matching: distinct projects must never merge. */
export const projectKey = (name: string) => name.toLowerCase().replace(/[\s._-]+/g, "");
/** The GitHub profile README repository is the candidate's profile, not a project. */
export const isProfileRepo = (name: string) => /[-_.]readme$/i.test(name) || /^\.?github$/i.test(name);

/** Section headings that older resume parsing could record as projects. */
const NOT_PROJECT = /\b(activities|achievements?|awards?|certifications?|education|experience|skills|summary|interests|hobbies|references)$/i;
const RANK: Record<string, number> = { demonstrated: 3, self_reported: 2, inferred: 1, unverified: 0 };

/** First readable paragraph: skips headings, badges, images, link-only lines and tables. */
export function firstParagraph(text: string, max = 260): string {
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const t = block.split("\n").filter((l) => !/^\s*(#|!\[|\[!\[|<|\||```|[-*]\s*\[|---|===)/.test(l)).join(" ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`>]/g, "").replace(/\s+/g, " ").trim();
    if (t.length >= 25 && /[a-z]{3}/i.test(t)) return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "..." : t;
  }
  return "";
}

export function buildInventory(ents: EntityLite[], evidence: Evidence[], opts: { onlyProviders?: string[] } = {}): InventoryItem[] {
  const merged = new Map<string, InventoryItem>();
  for (const e of ents) {
    if (e.kind !== "project" || isProfileRepo(e.name) || NOT_PROJECT.test(e.name)) continue;
    const provider = typeof e.data?.provider === "string" ? e.data.provider : null;
    if (opts.onlyProviders?.length && !(provider && opts.onlyProviders.includes(provider))) continue;
    const key = projectKey(e.name);
    const tech: string[] = Array.isArray(e.data?.technologies) ? e.data.technologies.filter((t: unknown) => typeof t === "string") : [];
    const cur = merged.get(key);
    if (cur) {
      if (RANK[e.level] > RANK[cur.level]) cur.level = e.level;
      cur.tech = [...new Set([...cur.tech, ...tech])];
      continue;
    }
    // Purpose: the candidate's own description, else the first readable paragraph of this project's README/doc, else "not documented".
    const key2 = e.name.toLowerCase();
    const ev = evidence.filter((x) => x.project?.toLowerCase() === key2 || (x.docType === "resume" && x.text.toLowerCase().includes(key2)));
    const best = ev.find((x) => x.docType === "readme") ?? ev.find((x) => x.project?.toLowerCase() === key2) ?? ev[0];
    const own = typeof e.data?.description === "string" ? e.data.description : "";
    const purpose = firstParagraph(own, 260) || (best && best.docType !== "resume" ? firstParagraph(best.text) : "") || (own ? own.slice(0, 260) : "Not documented in your sources.");
    merged.set(key, { key, name: e.name, level: e.level, purpose, tech, refs: ev.slice(0, 3).map((x) => x.id), provider });
  }
  return [...merged.values()].sort((a, b) => RANK[b.level] - RANK[a.level] || a.name.localeCompare(b.name));
}

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const STATUS: Record<string, string> = { demonstrated: "Repository found", self_reported: "Resume/profile claim only", inferred: "Inferred", unverified: "Unverified claim" };

/** One table, every project once. The count is computed from the deduplicated list. */
export function renderInventory(items: InventoryItem[], scope?: string): string {
  const head = `You have **${items.length}** distinct project${items.length === 1 ? "" : "s"}${scope ? ` in ${scope}` : " across your knowledge base"}.`;
  const rows = items.map((p, i) => `| ${i + 1} | **${cell(p.name)}** | ${cell(p.purpose)} ${p.refs.map((r) => `[${r}]`).join("")} | ${cell(p.tech.slice(0, 8).join(", ")) || "not documented"} | ${STATUS[p.level] ?? p.level} |`);
  const note = items.some((p) => p.level !== "demonstrated") ? "\n\n_\"Resume/profile claim only\" means the project appears in your resume or profile; no repository for it is indexed, so features and deployment are not verified._" : "";
  return `${head}\n\n| # | Project | Purpose | Technologies | Evidence |\n|---|---|---|---|---|\n${rows.join("\n")}${note}`;
}
