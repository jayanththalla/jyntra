// Pure helpers that read a resume's text (no model, no network): the projects it lists, and the skills it names.
// Everything found here is the candidate's OWN claim, so callers record it as "self_reported", never "demonstrated".
import { SKILL_DICTIONARY } from "@/lib/matching/skills";

const SECTION_END = /^((additional|other|extra|co)[- ]?(curricular\s+)?(activities|information|details|achievements)|(work\s+)?(professional\s+)?(experience|employment|internships?|education|academics?|(technical\s+|core\s+|key\s+)?skills|technologies|certifications?|courses|achievements?|awards?|honou?rs|publications?|summary|profile|objective|about( me)?|languages|interests|hobbies|references|extra[- ]?curricular|activities|volunteer(ing)?|leadership|positions? of responsibility|declaration|personal (details|information)|coding profiles?|links))\s*:?$/i;
const PROJECT_HEAD = /^(personal\s+|academic\s+|key\s+|selected\s+|major\s+|side\s+)?projects?(\s+(experience|work))?\s*:?$/i;
const BULLET = /^\s*[•·▪▫◦●○■□‣⁃*\-–—>+]\s*/;
// Sentences that describe work, not titles. PDF text often loses the bullet marker, so the first word is the tell.
const VERB_START = /^(built|architected|architect|combined|implemented|developed|designed|created|integrated|exposed|added|deployed|engineered|led|used|trained|wrote|achieved|improved|reduced|automated|enabled|optimi[sz]ed|leveraged|constructed|orchestrated|implementing|developing|designing|building|using|enforced|applied|collaborated|managed|maintained|performed|analy[sz]ed|conducted|containerized|migrated|set up|configured|tested)\b/i;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const knownTech = (t: string) => Object.values(SKILL_DICTIONARY).some((re) => re.test(t));
const sentence = (t: string, max = 240) => { const c = norm(t.replace(BULLET, "")); if (c.length <= max) return c; const cut = c.slice(0, max); const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; ")); return end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "..."; };

/** Names of the projects listed under a "Projects" heading. Title lines only; everything else under a title is its description. */
export function extractResumeProjects(text: string, max = 12): { name: string; tech: string[]; description: string }[] {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => norm(l.replace(/^[#\s]+/, ""))).filter(Boolean);
  const out: { name: string; tech: string[]; description: string }[] = [];
  let inside = false;
  const isDescription = (raw: string) => BULLET.test(raw) || VERB_START.test(raw.replace(BULLET, "")) || raw.length > 110 || /[.!?]$/.test(raw);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const bare = raw.replace(/[:\s]+$/, "");
    if (PROJECT_HEAD.test(bare)) { inside = true; continue; }
    if (!inside) continue;
    // A new section: a known heading, or a short ALL-CAPS line with no separators.
    if (SECTION_END.test(bare) || (/^[A-Z][A-Z &/]{3,40}$/.test(bare) && bare.split(" ").length <= 4)) break;
    const last = out[out.length - 1];
    if (isDescription(raw)) { if (last && !last.description) last.description = sentence(raw); continue; }
    const m = raw.match(/^(.{3,90}?)(?:\s*[|–—:(]\s*(.*))?$/);
    const sep = !!m?.[2];
    const name = norm((m?.[1] ?? raw).replace(/[|–—:(]+$/, "").replace(/\s*\(?\b(19|20)\d\d\)?$/, ""));
    const tech = (m?.[2] ?? "").replace(/[()]/g, "").split(/[,;|/]/).map((t) => norm(t)).filter((t) => t && t.length < 30).slice(0, 12);
    const next = lines[i + 1];
    const titleOk = name && name.split(" ").length <= 9 && !/[.!?]$/.test(name) && !/^\d/.test(name) && !/^(github|link|live|demo|source|tech|technologies|stack)\b/i.test(name)
      && (sep ? tech.some(knownTech) : name.split(" ").length <= 6 && !!next && isDescription(next));
    if (!titleOk) { if (last && !last.description) last.description = sentence(raw); continue; }
    if (!out.some((o) => o.name.toLowerCase() === name.toLowerCase())) out.push({ name, tech, description: "" });
    if (out.length >= max) break;
  }
  return out;
}

/** Skills the resume names, from the shared skills dictionary. */
export const extractResumeSkills = (text: string): string[] => Object.entries(SKILL_DICTIONARY).filter(([, re]) => re.test(text)).map(([n]) => n);
