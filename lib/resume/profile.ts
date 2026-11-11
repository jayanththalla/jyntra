// Resume -> structured profile for interviews, plus evidence-based role recommendations. Deterministic: no model call, so nothing
// can be invented. Every value is text or a skill that is actually present in the resume; the user reviews and corrects it
// before an interview uses it. E-mail addresses, phone numbers and street addresses are NOT extracted or stored.
import { skillsMentioned } from "@/lib/matching/skills";
import { parseResumeText } from "./parse";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export type ResumeKind = "pdf" | "docx";

export class ResumeFileError extends Error {
  constructor(public code: "empty" | "too_large" | "unsupported" | "legacy_doc", message: string) { super(message); this.name = "ResumeFileError"; }
}

/** Decides the file type from its CONTENT (magic bytes), never from the file name or the declared MIME type. */
export function sniffResume(bytes: Uint8Array): ResumeKind {
  if (!bytes.length) throw new ResumeFileError("empty", "The file is empty.");
  if (bytes.length > MAX_RESUME_BYTES) throw new ResumeFileError("too_large", "Resumes can be at most 5 MB.");
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) throw new ResumeFileError("legacy_doc", "Old .doc files are not supported. Save the resume as .docx or PDF.");
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5)) {
    // A ZIP is only a Word document if it holds word/document.xml (entry names are stored in clear in the local headers).
    if (Buffer.from(bytes).includes(Buffer.from("word/document.xml"))) return "docx";
  }
  throw new ResumeFileError("unsupported", "Only PDF and DOCX resumes are supported.");
}

export interface ResumeEntry { heading: string; details: string[]; technologies: string[] }
export interface ResumeProfile {
  name: string | null;
  education: string[];
  skills: string[];
  programmingLanguages: string[];
  frameworks: string[];
  experience: ResumeEntry[];
  internships: ResumeEntry[];
  projects: ResumeEntry[];
  achievements: string[];
  certifications: string[];
  experienceYears: number | null;
  warnings: string[];
}

const LANGUAGES = new Set(["Python", "JavaScript", "TypeScript", "SQL", "Java", "Go", "C++", "C#", "Rust", "Kotlin", "Swift", "Ruby", "PHP"]);
const FRAMEWORKS = new Set(["React", "React Native", "Next.js", "Node.js", "Express.js", "FastAPI", "Django", "Flask", "Spring", "Angular", "Vue", "Tailwind CSS", "TailwindCSS", "Redux", "Flutter", "LangChain", "LangGraph", "PyTorch", "TensorFlow", "Pandas", "NumPy", "Playwright", "Selenium", "Cypress", "Jest", "Pytest"]);

const SECTION_RES: [string, RegExp][] = [
  ["education", /^(education|academics?|academic (background|qualifications?)|qualifications?)$/i],
  ["skills", /^((technical|core|key) )?skills?( (&|and) (tools|technologies))?|technologies|tech stack|tools( (&|and) technologies)?$/i],
  ["experience", /^((work|professional|industry|relevant) )?experience|employment( history)?$/i],
  ["internships", /^internships?( experience)?$/i],
  ["projects", /^((academic|personal|key|selected|notable) )?projects?$/i],
  ["achievements", /^(achievements?|awards?( (&|and) (honou?rs|achievements))?|honou?rs|accomplishments|extra[- ]?curriculars?|positions of responsibility)$/i],
  ["certifications", /^(certifications?|certificates?|licen[sc]es( (&|and) certifications?)?|courses?)$/i],
  ["summary", /^(summary|profile|objective|about( me)?|professional summary|career objective)$/i],
];
const BULLET = /^\s*([•●▪■◦○·*\-–—]|\d{1,2}[.)])\s+/;

function sectionOf(line: string): string | null {
  const t = line.replace(/[:|]+$/g, "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 40 || /[.,;@]/.test(t)) return null;
  for (const [k, re] of SECTION_RES) if (re.test(t)) return k;
  return null;
}

// LITERAL matches only. (The Atlas parser also infers JavaScript from "Node.js"; an interview profile must not claim what the resume never says.)
// The dictionary pattern for JavaScript also matches the ".js" in "Node.js", "Next.js" or "Vue.js"; require a real mention.
const REAL_JS = /\bjavascript\b|\bes6\b|(?<![.\w-])js\b/i;
const skillsIn = (text: string) => skillsMentioned(text, new Set()).filter((s) => s !== "JavaScript" || REAL_JS.test(text));

function entriesOf(lines: string[]): ResumeEntry[] {
  const out: ResumeEntry[] = [];
  let cur: ResumeEntry | null = null;
  let lastWasBullet = false;
  let blankBefore = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { blankBefore = true; continue; }
    const isBullet = BULLET.test(line);
    const text = line.replace(BULLET, "").trim();
    // A new entry starts at the first line, or at a plain line that follows bullets or a blank line.
    if (!cur || (!isBullet && (lastWasBullet || blankBefore))) {
      cur = { heading: text.slice(0, 160), details: [], technologies: [] };
      out.push(cur);
    } else {
      cur.details.push(text.slice(0, 400));
    }
    lastWasBullet = isBullet;
    blankBefore = false;
  }
  for (const e of out) e.technologies = skillsIn([e.heading, ...e.details].join(" \n "));
  return out.filter((e) => e.heading || e.details.length).slice(0, 12);
}

const PAGE_MARK = /^\[page \d+\]$/i;
const LINKISH = /(@|linkedin\.com|github\.com\/|https?:\/\/)/i;
/** A phone number has 10-13 digits in one run. A date range such as "2022 - 2026" has only 8 and must not be mistaken for one. */
function hasPhone(t: string): boolean {
  for (const m of t.matchAll(/\+?\d[\d\s().-]{8,}\d/g)) { const d = m[0].replace(/\D/g, "").length; if (d >= 10 && d <= 13) return true; }
  return false;
}
const isContact = (t: string) => LINKISH.test(t) || hasPhone(t);

export function extractResumeProfile(raw: string): ResumeProfile {
  const warnings: string[] = [];
  const lines = raw.replace(/\r/g, "").split("\n").filter((l) => !PAGE_MARK.test(l.trim()));
  const sections: Record<string, string[]> = {};
  let cur = "header";
  for (const l of lines) {
    const s = sectionOf(l);
    if (s) { cur = s; sections[cur] ??= []; continue; }
    (sections[cur] ??= []).push(l);
  }

  // Name: the first plain line of 2-4 capitalised words in the header (no digits, e-mail, links or section words).
  let name: string | null = null;
  for (const l of (sections.header ?? []).slice(0, 8)) {
    const t = l.trim();
    if (t && !isContact(t) && /^[A-Z][A-Za-z'.-]+(\s+[A-Z][A-Za-z'.-]+){1,3}$/.test(t) && !sectionOf(t)) { name = t; break; }
  }
  if (!name) warnings.push("Could not find your name. Add it if you want it in the report.");

  const parsed = parseResumeText(raw);
  const skills = skillsIn(raw);
  const skillsText = (sections.skills ?? []).join(" ");
  const inSkillsSection = skillsIn(skillsText);
  // A skill that appears only in the skills list (not in any project or job) is kept but is later treated as "claimed", not "demonstrated".
  const all = [...new Set([...skills, ...inSkillsSection])];

  const clip = (xs: string[], n: number, len = 240) => xs.map((x) => x.replace(BULLET, "").trim()).filter((x) => x && !isContact(x)).slice(0, n).map((x) => x.slice(0, len));
  const education = clip(sections.education ?? [], 8);
  const experienceAll = entriesOf(sections.experience ?? []);
  const internFromExp = experienceAll.filter((e) => /\bintern(ship)?\b/i.test(e.heading));
  const experience = experienceAll.filter((e) => !/\bintern(ship)?\b/i.test(e.heading));
  const internships = [...entriesOf(sections.internships ?? []), ...internFromExp];
  const projects = entriesOf(sections.projects ?? []);
  const achievements = clip(sections.achievements ?? [], 10);
  const certifications = clip(sections.certifications ?? [], 10);

  if (!all.length) warnings.push("No known technical skills were found. Add your skills manually.");
  if (!projects.length && !experience.length && !internships.length) warnings.push("No projects or work experience sections were recognised. Check the text and add them, or interview questions will stay general.");

  return {
    name, education, skills: all,
    programmingLanguages: all.filter((s) => LANGUAGES.has(s)), frameworks: all.filter((s) => FRAMEWORKS.has(s)),
    experience, internships, projects, achievements, certifications, experienceYears: parsed.experienceYears, warnings,
  };
}

/** Normalises a profile coming back from the review form: types, lengths and counts are enforced; unknown fields are dropped. */
export function sanitizeProfile(input: unknown): ResumeProfile {
  const i = (input ?? {}) as Record<string, any>;
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");
  const strs = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v.map((x) => s(x, len)).filter(Boolean).slice(0, n) : []);
  const entries = (v: unknown): ResumeEntry[] => (Array.isArray(v) ? v : []).slice(0, 12).map((e: any) => ({ heading: s(e?.heading, 160), details: strs(e?.details, 10, 400), technologies: strs(e?.technologies, 20, 40) })).filter((e) => e.heading || e.details.length);
  const yrs = Number(i.experienceYears);
  return {
    name: s(i.name, 80) || null, education: strs(i.education, 8, 240), skills: strs(i.skills, 60, 40),
    programmingLanguages: strs(i.programmingLanguages, 30, 40), frameworks: strs(i.frameworks, 40, 40),
    experience: entries(i.experience), internships: entries(i.internships), projects: entries(i.projects),
    achievements: strs(i.achievements, 10, 240), certifications: strs(i.certifications, 10, 240),
    experienceYears: Number.isFinite(yrs) && yrs >= 0 && yrs <= 40 ? yrs : null, warnings: strs(i.warnings, 6, 200),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Role recommendations. Rules, not a model: a role is suggested only when the profile itself contains matching skills.
// ---------------------------------------------------------------------------------------------------------------------
interface RoleRule { role: string; core: string[]; keywords: RegExp }
const ROLE_RULES: RoleRule[] = [
  { role: "Backend Developer", core: ["Node.js", "Express.js", "Python", "Django", "FastAPI", "Flask", "Java", "Spring", "PostgreSQL", "MySQL", "MongoDB", "REST APIs", "RESTAPIs", "Redis", "Docker"], keywords: /\b(api|backend|server|database|microservice)\b/i },
  { role: "Frontend Developer", core: ["React", "JavaScript", "TypeScript", "HTML/CSS", "Next.js", "Angular", "Vue", "Tailwind CSS", "TailwindCSS", "Redux"], keywords: /\b(ui|frontend|front-end|responsive|component|web ?app)\b/i },
  { role: "Full Stack Developer", core: ["React", "Node.js", "Express.js", "JavaScript", "TypeScript", "MongoDB", "PostgreSQL", "Next.js", "REST APIs", "RESTAPIs"], keywords: /\b(full[- ]?stack|mern|web ?app)\b/i },
  { role: "Data Analyst", core: ["SQL", "Python", "Pandas", "NumPy", "Excel", "Power BI", "Tableau"], keywords: /\b(dashboard|analysis|analytics|eda|report)\b/i },
  { role: "ML Engineer", core: ["Python", "Machine Learning", "Deep Learning", "PyTorch", "TensorFlow", "Pandas", "NumPy", "NLP", "Computer Vision"], keywords: /\b(model|training|classification|prediction|neural)\b/i },
  { role: "AI Engineer", core: ["Python", "LLM / GenAI", "LLM/GenAI", "LangChain", "LangGraph", "RAG", "AI Agents", "AIAgents", "Prompt Engineering", "PromptEngineering"], keywords: /\b(llm|rag|agent|prompt|embedding|chatbot)\b/i },
  { role: "DevOps Engineer", core: ["Docker", "Kubernetes", "AWS", "GCP", "Azure", "Terraform", "CI/CD", "Linux", "Git"], keywords: /\b(deploy|pipeline|infrastructure|ci\/cd|container)\b/i },
  { role: "Mobile Developer", core: ["Flutter", "React Native", "ReactNative", "Kotlin", "Swift"], keywords: /\b(android|ios|mobile app)\b/i },
  { role: "QA / Test Engineer", core: ["Selenium", "Cypress", "Playwright", "Pytest", "Jest", "Postman", "API Testing", "APITesting"], keywords: /\b(test|automation|qa)\b/i },
  { role: "Software Engineer", core: ["Java", "Python", "C++", "Go", "Git", "SQL"], keywords: /\b(algorithm|data structure|system)\b/i },
];

export interface RoleRecommendation {
  role: string; fit: number;
  matchingSkills: string[];
  relevantProjects: { name: string; because: string }[];
  relevantInternships: { name: string; because: string }[];
  missingSkills: string[];
  level: "intern" | "junior" | "mid" | "senior";
  difficulty: "easy" | "medium" | "hard";
  difficultyReason: string;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");

export function inferLevel(p: ResumeProfile): { level: RoleRecommendation["level"]; difficulty: RoleRecommendation["difficulty"]; reason: string } {
  const years = p.experienceYears ?? (p.experience.length >= 3 ? 3 : p.experience.length >= 1 ? 1 : 0);
  if (years >= 6) return { level: "senior", difficulty: "hard", reason: `Resume states about ${years} years of experience.` };
  if (years >= 3) return { level: "mid", difficulty: "medium", reason: `Resume suggests about ${years} years of experience.` };
  if (p.experience.length >= 1 || (p.experienceYears ?? 0) >= 1 || p.internships.length >= 2) return { level: "junior", difficulty: "medium", reason: p.experience.length ? "Has work experience but under 3 years." : "Has internships but little full-time experience." };
  return { level: "intern", difficulty: "easy", reason: p.internships.length || p.projects.length ? "Experience is mainly projects and at most one internship." : "No experience section was found, so questions start easy." };
}

export function recommendRoles(p: ResumeProfile, max = 5): RoleRecommendation[] {
  const have = new Map(p.skills.map((s) => [key(s), s] as const));
  const lv = inferLevel(p);
  const out: RoleRecommendation[] = [];
  for (const r of ROLE_RULES) {
    const coreKeys = [...new Set(r.core.map(key))];
    const matching = [...new Set(r.core.filter((c) => have.has(key(c))).map((c) => have.get(key(c))!))];
    const matchedKeys = new Set(matching.map(key));
    const evidence = (e: ResumeEntry) => {
      const techs = e.technologies.filter((t) => coreKeys.includes(key(t)));
      const text = [e.heading, ...e.details].join(" ");
      if (techs.length) return `uses ${techs.slice(0, 4).join(", ")}`;
      if (r.keywords.test(text)) return `describes ${(text.match(r.keywords) ?? [""])[0]!.toLowerCase()} work`;
      return null;
    };
    const proj = p.projects.map((e) => ({ name: e.heading, because: evidence(e) })).filter((x): x is { name: string; because: string } => !!x.because).slice(0, 3);
    const intern = [...p.internships, ...p.experience].map((e) => ({ name: e.heading, because: evidence(e) })).filter((x): x is { name: string; because: string } => !!x.because).slice(0, 3);
    // Needs real overlap: two matching skills, or one plus a project/internship that backs it.
    if (!(matching.length >= 2 || (matching.length >= 1 && (proj.length || intern.length)))) continue;
    const missing = [...new Set(r.core.filter((c) => !matchedKeys.has(key(c))).map((c) => c.replace(/^(LLM\/GenAI|RESTAPIs|TailwindCSS|AIAgents|PromptEngineering|ReactNative|APITesting)$/, (m) => ({ "LLM/GenAI": "LLM / GenAI", RESTAPIs: "REST APIs", TailwindCSS: "Tailwind CSS", AIAgents: "AI Agents", PromptEngineering: "Prompt Engineering", ReactNative: "React Native", APITesting: "API Testing" } as Record<string, string>)[m] ?? m)))].filter((m) => !have.has(key(m))).slice(0, 4);
    const fit = Math.min(100, Math.round((matchedKeys.size / Math.min(coreKeys.length, 6)) * 70 + Math.min(proj.length + intern.length, 3) * 10));
    out.push({ role: r.role, fit, matchingSkills: matching.slice(0, 8), relevantProjects: proj, relevantInternships: intern, missingSkills: missing, level: lv.level, difficulty: lv.difficulty, difficultyReason: lv.reason });
  }
  return out.sort((a, b) => b.fit - a.fit).slice(0, max);
}

/** Facts the interviewer may use. Only items present in the reviewed profile; a skill that is merely listed is marked as claimed. */
export function interviewerContext(p: ResumeProfile): { skills: string[]; projects: { name: string; description?: string }[]; demonstratedSkills: string[]; claimedOnly: string[] } {
  const shown = new Set([...p.projects, ...p.experience, ...p.internships].flatMap((e) => e.technologies.map(key)));
  const demonstrated = p.skills.filter((s) => shown.has(key(s)));
  return {
    skills: p.skills.slice(0, 30),
    projects: p.projects.slice(0, 4).map((e) => ({ name: e.heading, description: e.details.slice(0, 3).join(" ").slice(0, 400) || undefined })),
    demonstratedSkills: demonstrated, claimedOnly: p.skills.filter((s) => !shown.has(key(s))),
  };
}
