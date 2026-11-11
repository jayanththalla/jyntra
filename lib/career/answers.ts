// Application-answer pipeline for ONE question:
//   intent -> missing-fact check -> retrieval -> one model call -> parse -> limit check (one rewrite, then a clean cut)
//   -> consistency warnings -> citations from the evidence the model reported using.
// Retrieval and the model are injected (`deps`) so the whole pipeline is tested with fakes.
import { toEvidence, type Citation, type Evidence, KbError } from "@/lib/kb/answer";
import type { Hit } from "@/lib/kb/search";
import { keywords } from "@/lib/kb/search";
import {
  buildAnswerPrompt, buildShortenPrompt, checkConsistency, countText, detectIntent, fitToLimit, mentionedSkills, missingForIntent, overLimit, parseModelAnswer,
  type Adjust, type CandidateLite, type FactLite, type Intent, type Limits, type MissingItem,
} from "./application";

export interface AnswerDeps {
  retrieve: (userId: number, q: string, o: { sourceIds?: number[]; projects?: string[] }) => Promise<Hit[]>;
  overview: (userId: number, o: { sourceIds?: number[]; limit?: number }) => Promise<Hit[]>;
  /** The chosen resume document (or the newest one), as a single passage. */
  resume: (userId: number, documentId?: number | null) => Promise<Hit[]>;
  entities: (userId: number) => Promise<{ kind: string; name: string; level: string; data: any }[]>;
  projectNames: (userId: number) => Promise<string[]>;
  /** Facts the candidate confirmed. AI-suggested facts are never returned here. */
  facts: (userId: number) => Promise<FactLite[]>;
  complete: (prompt: string) => Promise<{ text: string; provider: string }>;
  aiConfigured: () => boolean;
}

export interface AnswerInput {
  question: string;
  limits: Limits;
  sourceIds?: number[];
  resumeDocumentId?: number | null;
  job?: { title: string; company: string; text: string } | null;
  jd?: string;
  adjust?: Adjust;
  previousAnswer?: string;
}

export interface AnswerOutput {
  answer: string;
  status: "complete" | "needs_input";
  intent: Intent;
  missing: MissingItem[];
  warnings: string[];
  citations: Citation[];
  words: number;
  chars: number;
  provider?: string;
  modelCalls: number;
}

const BROAD: Intent[] = ["about_yourself", "why_hire", "challenging_project", "career_goals", "strengths", "teamwork", "problem_solving"];
const WITH_RESUME: Intent[] = ["about_yourself", "why_hire", "technical_experience", "career_goals", "general"];

export function profileFacts(p: CandidateLite & Record<string, any>): string[] {
  const out: string[] = [];
  if (p.name) out.push(`Name: ${p.name}`);
  if (p.target_roles?.length) out.push(`Target roles (self-reported): ${p.target_roles.slice(0, 5).join(", ")}`);
  if (typeof p.tech_experience_years === "number" && p.tech_experience_years > 0) out.push(`Years of experience (self-reported): ${p.tech_experience_years}`);
  if (p.skills?.length) out.push(`Skills (self-reported): ${p.skills.slice(0, 15).join(", ")}`);
  for (const e of (p.experience ?? []).slice(0, 4)) out.push(`Experience (self-reported): ${e.title} at ${e.company}`);
  for (const e of (p.education ?? []).slice(0, 2)) out.push(`Education (self-reported): ${e.degree}, ${e.institution}`);
  if (p.preferred_locations?.length) out.push(`Preferred locations: ${p.preferred_locations.slice(0, 5).join(", ")}`);
  if (p.remote_preference && p.remote_preference !== "unknown") out.push(`Remote preference: ${p.remote_preference}`);
  for (const [k, label] of [["github_url", "GitHub"], ["linkedin_url", "LinkedIn"], ["portfolio_url", "Portfolio"]] as const) if (p[k]) out.push(`${label}: ${p[k]}`);
  return out;
}

export async function answerOne(user: { id: number; profile: any }, input: AnswerInput, deps: AnswerDeps): Promise<AnswerOutput> {
  const question = input.question.trim();
  const intent = detectIntent(question);
  const warnings: string[] = [];
  const facts = await deps.facts(user.id);
  const profile = user.profile as CandidateLite & Record<string, any>;
  const hasJob = !!(input.job || (input.jd && input.jd.trim().length > 40));
  const base = { intent, words: 0, chars: 0, modelCalls: 0 };
  const stop = (missing: MissingItem[], answer = ""): AnswerOutput => ({ ...base, answer, status: "needs_input", missing, warnings, citations: [], ...countText(answer) });

  // Facts only the candidate can give (salary, notice period ...) are asked for before anything is retrieved or generated.
  const early = missingForIntent(intent, { profile, facts, hasJob, hasEvidence: true });
  if (early.length) return stop(early);

  // Links come straight from the profile: no model, nothing to get wrong.
  if (intent === "links") {
    const lines = [["GitHub", profile.github_url], ["LinkedIn", profile.linkedin_url], ["Portfolio", profile.portfolio_url]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    const answer = lines.join("\n");
    return { ...base, answer, status: "complete", missing: [], warnings, citations: [], ...countText(answer) };
  }

  // ---- retrieval: broad questions get a balanced selection, specific ones focused evidence ----
  const names = await deps.projectNames(user.id);
  const named = names.filter((n) => n.length >= 3 && question.toLowerCase().includes(n.toLowerCase()));
  const jdText = input.job?.text ?? input.jd ?? "";
  const jdSkills = mentionedSkills(jdText).slice(0, 6);
  const searchText = `${question} ${jdSkills.join(" ")} ${input.job?.title ?? ""}`;
  const hits: Hit[] = [];
  const seen = new Set<number>();
  const add = (hs: Hit[]) => hs.forEach((h) => { if (!seen.has(h.chunkId)) (seen.add(h.chunkId), hits.push(h)); });
  if (WITH_RESUME.includes(intent) || input.resumeDocumentId) add(await deps.resume(user.id, input.resumeDocumentId));
  if (named.length) add(await deps.retrieve(user.id, `${searchText} ${named.join(" ")}`, { sourceIds: input.sourceIds, projects: named }));
  if (BROAD.includes(intent) && !named.length) add((await deps.overview(user.id, { sourceIds: input.sourceIds, limit: 6 })).slice(0, 6));
  if (keywords(searchText).length) add(await deps.retrieve(user.id, searchText, { sourceIds: input.sourceIds }));
  const evidence: Evidence[] = toEvidence(hits, { max: 8, perItem: 1100 });

  const ents = await deps.entities(user.id);
  const hasEvidence = evidence.length > 0 || facts.length > 0 || ents.some((e) => e.level === "demonstrated");
  const factLines = [...profileFacts(profile), ...facts.map((f) => `Confirmed by me (${f.category}): ${f.text}`)];
  const late = missingForIntent(intent, { profile, facts, hasJob, hasEvidence });
  if (late.length) return { ...stop(late), }; // nothing to ground an answer in: say so rather than guess
  if (!deps.aiConfigured()) throw new KbError("not_configured", "AI answers aren't set up on this server (no GROQ_API_KEY or GEMINI_API_KEY).");

  const prompt = buildAnswerPrompt({ question, intent, limits: input.limits, evidence, facts: factLines, job: input.job, jd: input.job ? undefined : input.jd, adjust: input.adjust, previousAnswer: input.previousAnswer });
  let calls = 1;
  let { text, provider } = await deps.complete(prompt);
  let parsed = parseModelAnswer(text);
  if (!parsed.answer) throw new KbError("ai_failed", "The AI returned an empty answer. Try again.", 502);

  // ---- limits: one rewrite, then a clean cut at a sentence boundary ----
  if (overLimit(parsed.answer, input.limits)) {
    calls++;
    try {
      const again = parseModelAnswer((await deps.complete(buildShortenPrompt(parsed.answer, input.limits))).text);
      if (again.answer && countText(again.answer).chars < countText(parsed.answer).chars) parsed = { ...parsed, answer: again.answer };
    } catch { /* keep the first answer; it is cut below */ }
    if (overLimit(parsed.answer, input.limits)) {
      parsed = { ...parsed, answer: fitToLimit(parsed.answer, input.limits) };
      warnings.push("The answer was cut at the last full sentence that fits the limit. Check that it still reads well.");
    }
  }

  // ---- consistency: anything the sources don't support is flagged for the candidate to confirm ----
  const corpus = [...evidence.map((e) => e.text), ...factLines, jdText, input.previousAnswer ?? ""].join("\n");
  warnings.push(...checkConsistency(parsed.answer, corpus, question));
  for (const a of parsed.assumptions) warnings.push(`Assumption: ${a}`);

  const ids = new Set(evidence.map((e) => e.id));
  let usedIds = parsed.used.map((u) => u.replace(/[\[\]\s]/g, "")).filter((u) => ids.has(u));
  if (!usedIds.length) usedIds = evidence.filter((e) => (e.project && parsed.answer.toLowerCase().includes(e.project.toLowerCase())) || (e.title.length > 3 && parsed.answer.toLowerCase().includes(e.title.toLowerCase()))).map((e) => e.id);
  const citations: Citation[] = evidence.filter((e) => usedIds.includes(e.id)).map((e) => ({ id: e.id, title: e.title, url: e.url, locator: e.locator, provider: e.provider, docType: e.docType, documentId: e.documentId, snippet: e.text.slice(0, 240) }));
  if (!citations.length && !["salary", "notice_period", "work_authorization", "relocation"].includes(intent)) warnings.push("This answer isn't tied to any of your sources. Check every claim about you before using it.");

  const missing: MissingItem[] = parsed.missing.map((m) => ({ key: "detail", ask: m }));
  const counts = countText(parsed.answer);
  return { ...base, answer: parsed.answer, status: missing.length ? "needs_input" : "complete", missing, warnings: [...new Set(warnings)].slice(0, 8), citations, provider, modelCalls: calls, ...counts };
}
