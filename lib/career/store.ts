// Persistence for Career GPT: confirmed facts, application answer sets. EVERY function takes userId and filters on it.
import { query } from "@/lib/database";
import { defaultDeps as kbDefaultDeps } from "@/lib/kb/answer";
import { listEntities } from "@/lib/kb/store";
import { listProjectNames, projectOverview, searchChunks, type Hit } from "@/lib/kb/search";
import type { AnswerDeps, AnswerOutput } from "./answers";
import { detectLimits, parseApplicationInput, type Limits } from "./application";

// ------------------------------------------------------------------ facts ---
export const FACT_CATEGORIES = ["general", "salary", "notice_period", "availability", "work_authorization", "relocation", "preference", "achievement"] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

export const listFacts = (userId: number) =>
  query("SELECT id, category, text, origin, conversation_id, created_at, updated_at FROM kb_facts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200", [userId]);

/** `origin` 'user_confirmed' = the candidate typed or confirmed it. 'ai_suggested' = kept from a model answer; unused until confirmed. */
export async function addFact(userId: number, p: { category?: string; text: string; origin?: "user_confirmed" | "ai_suggested"; conversationId?: number | null }) {
  const category = (FACT_CATEGORIES as readonly string[]).includes(p.category ?? "") ? p.category! : "general";
  // A conversation link is kept only when that conversation is the caller's own.
  const [f] = await query(
    `INSERT INTO kb_facts (user_id, category, text, origin, conversation_id)
     VALUES ($1,$2,$3,$4,(SELECT id FROM kb_conversations WHERE id = $5 AND user_id = $1)) RETURNING id, category, text, origin, conversation_id, created_at, updated_at`,
    [userId, category, p.text.slice(0, 1000), p.origin ?? "user_confirmed", p.conversationId ?? null]
  );
  return f;
}
export async function updateFact(userId: number, id: number, p: { text?: string; category?: string; confirm?: boolean }) {
  const [f] = await query(
    `UPDATE kb_facts SET text = COALESCE($3, text), category = COALESCE($4, category), origin = CASE WHEN $5 THEN 'user_confirmed' ELSE origin END, updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING id, category, text, origin, created_at, updated_at`,
    [id, userId, p.text?.slice(0, 1000) ?? null, p.category && (FACT_CATEGORIES as readonly string[]).includes(p.category) ? p.category : null, !!p.confirm]
  );
  return f ?? null;
}
export const deleteFact = async (userId: number, id: number) => (await query("DELETE FROM kb_facts WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).length > 0;
export const confirmedFacts = (userId: number) => query<{ category: string; text: string }>("SELECT category, text FROM kb_facts WHERE user_id = $1 AND origin = 'user_confirmed' ORDER BY created_at DESC LIMIT 60", [userId]);

// ----------------------------------------------------- default deps (DB) ---
const asHit = (d: any, i: number): Hit => ({ chunkId: -(i + 5000), documentId: d.id, sourceId: d.source_id, provider: d.provider, docType: d.doc_type, title: d.title, url: d.url, project: d.project, locator: "resume", content: d.content, modifiedAt: null, syncedAt: new Date(d.synced_at).toISOString(), score: 1 });

export function defaultAnswerDeps(): AnswerDeps {
  const kb = kbDefaultDeps();
  return {
    retrieve: (userId, q, o) => searchChunks(userId, q, { sourceIds: o.sourceIds, projects: o.projects, limit: 10 }),
    overview: (userId, o) => projectOverview(userId, o),
    resume: async (userId, documentId) => {
      const rows = await query<any>(
        `SELECT id, source_id, provider, doc_type, title, url, project, left(content, 3500) AS content, synced_at FROM kb_documents
         WHERE user_id = $1 AND status = 'indexed' AND doc_type = 'resume' ${documentId ? "AND id = $2" : ""} ORDER BY synced_at DESC LIMIT 1`,
        documentId ? [userId, documentId] : [userId]
      );
      return rows.map(asHit);
    },
    entities: (userId) => listEntities(userId),
    projectNames: (userId) => listProjectNames(userId),
    facts: (userId) => confirmedFacts(userId),
    complete: kb.complete,
    aiConfigured: kb.aiConfigured,
  };
}

/** Resume versions the candidate can pick from. */
export const listResumes = (userId: number) =>
  query<{ id: number; title: string; synced_at: string }>("SELECT id, title, synced_at FROM kb_documents WHERE user_id = $1 AND doc_type = 'resume' AND status = 'indexed' ORDER BY synced_at DESC LIMIT 20", [userId]);

/** Job text for one of the user's own applications (job description if saved, else the company description). */
export async function loadApplicationJob(userId: number, applicationId: number) {
  const [r] = await query<any>(
    `SELECT COALESCE(s.name, a.company_name) AS company, COALESCE(j.job_title, a.role_title) AS job_title, j.description, j.skills, s.description AS startup_description
     FROM applications a LEFT JOIN startups s ON s.id = a.startup_id LEFT JOIN jobs j ON j.id = a.job_id
     WHERE a.id = $1 AND a.user_id = $2`,
    [applicationId, userId]
  );
  if (!r) return null;
  const text = [r.description, r.skills?.length ? `Skills: ${r.skills.join(", ")}` : "", r.startup_description ? `About the company: ${r.startup_description}` : ""].filter(Boolean).join("\n").slice(0, 8000);
  return { title: r.job_title ?? "Role at " + r.company, company: r.company as string, text };
}

// ------------------------------------------------------ answer sets (DB) ---
const ANSWER_COLS = "id, set_id, position, question, word_limit, char_limit, intent, answer, status, missing, warnings, citations, edited, updated_at";

export async function createSet(userId: number, p: { title?: string; raw: string; jd?: string; applicationId?: number | null; resumeDocumentId?: number | null; sourceIds?: number[] }) {
  const parsed = parseApplicationInput(p.raw);
  if (!parsed.questions.length) return { error: "no_questions" as const };
  const jd = (p.jd?.trim() || parsed.jd).slice(0, 12_000);
  const title = (p.title?.trim() || parsed.questions[0].text).slice(0, 100);
  const [s] = await query<{ id: number }>(
    "INSERT INTO app_answer_sets (user_id, application_id, title, jd_text, resume_document_id, source_ids) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [userId, p.applicationId ?? null, title, jd, p.resumeDocumentId ?? null, p.sourceIds ?? []]
  );
  for (const q of parsed.questions) {
    await query("INSERT INTO app_answers (user_id, set_id, position, question, word_limit, char_limit) VALUES ($1,$2,$3,$4,$5,$6)", [userId, s.id, q.position, q.text, q.wordLimit, q.charLimit]);
  }
  return { set: await getSet(userId, s.id) };
}

export const listSets = (userId: number, limit = 20, offset = 0) =>
  query(
    `SELECT s.id, s.title, s.application_id, s.updated_at, count(a.id)::int AS total,
            count(a.id) FILTER (WHERE a.status = 'complete')::int AS complete, count(a.id) FILTER (WHERE a.status = 'needs_input')::int AS needs_input
     FROM app_answer_sets s LEFT JOIN app_answers a ON a.set_id = s.id AND a.user_id = s.user_id
     WHERE s.user_id = $1 GROUP BY s.id ORDER BY s.updated_at DESC LIMIT $2 OFFSET $3`,
    [userId, Math.min(Math.max(limit, 1), 50), Math.max(offset, 0)]
  );

export async function getSet(userId: number, id: number) {
  const [s] = await query("SELECT id, title, application_id, jd_text, resume_document_id, source_ids, created_at, updated_at FROM app_answer_sets WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!s) return null;
  const answers = await query(`SELECT ${ANSWER_COLS} FROM app_answers WHERE set_id = $1 AND user_id = $2 ORDER BY position`, [id, userId]);
  return { ...s, answers };
}

export async function updateSet(userId: number, id: number, p: { title?: string; jd_text?: string; application_id?: number | null; resume_document_id?: number | null; source_ids?: number[] }) {
  if (p.application_id) {
    const [a] = await query("SELECT id FROM applications WHERE id = $1 AND user_id = $2", [p.application_id, userId]);
    if (!a) return { error: "application_not_found" as const };
  }
  if (p.resume_document_id) {
    const [d] = await query("SELECT id FROM kb_documents WHERE id = $1 AND user_id = $2 AND doc_type = 'resume'", [p.resume_document_id, userId]);
    if (!d) return { error: "resume_not_found" as const };
  }
  const has = (k: keyof typeof p) => (k in p ? 1 : 0);
  const rows = await query(
    `UPDATE app_answer_sets SET title = COALESCE($3, title), jd_text = COALESCE($4, jd_text),
       application_id = CASE WHEN $5 = 1 THEN $6::int ELSE application_id END, resume_document_id = CASE WHEN $7 = 1 THEN $8::int ELSE resume_document_id END,
       source_ids = COALESCE($9, source_ids), updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId, p.title?.slice(0, 100) ?? null, p.jd_text?.slice(0, 12_000) ?? null, has("application_id"), p.application_id ?? null, has("resume_document_id"), p.resume_document_id ?? null, p.source_ids ?? null]
  );
  return rows.length ? { ok: true as const } : { error: "not_found" as const };
}

export const deleteSet = async (userId: number, id: number) => (await query("DELETE FROM app_answer_sets WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).length > 0;

export async function getAnswer(userId: number, id: number) {
  const [a] = await query<any>(`SELECT ${ANSWER_COLS}, user_id FROM app_answers WHERE id = $1 AND user_id = $2`, [id, userId]);
  return a ?? null;
}

export async function addQuestion(userId: number, setId: number, text: string) {
  const [s] = await query("SELECT id FROM app_answer_sets WHERE id = $1 AND user_id = $2", [setId, userId]);
  if (!s) return null;
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM app_answers WHERE set_id = $1 AND user_id = $2", [setId, userId]);
  if (n >= 30) return null;
  const l = detectLimits(text);
  const [a] = await query(`INSERT INTO app_answers (user_id, set_id, position, question, word_limit, char_limit) VALUES ($1,$2,(SELECT COALESCE(max(position),0)+1 FROM app_answers WHERE set_id = $2),$3,$4,$5) RETURNING ${ANSWER_COLS}`, [userId, setId, text.slice(0, 2000), l.words, l.chars]);
  await query("UPDATE app_answer_sets SET updated_at = now() WHERE id = $1", [setId]);
  return a;
}

export const deleteAnswer = async (userId: number, id: number) => (await query("DELETE FROM app_answers WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId])).length > 0;

/** Manual edit by the candidate. A non-empty edit counts as complete; clearing it returns the card to pending. */
export async function editAnswer(userId: number, id: number, p: { answer?: string; question?: string; word_limit?: number | null; char_limit?: number | null }) {
  const cur = await getAnswer(userId, id);
  if (!cur) return null;
  const answer = p.answer !== undefined ? p.answer.slice(0, 20_000) : cur.answer;
  const status = p.answer !== undefined ? (answer.trim() ? "complete" : "pending") : cur.status;
  const [a] = await query(
    `UPDATE app_answers SET answer = $3, question = COALESCE($4, question), word_limit = CASE WHEN $5 THEN $6::int ELSE word_limit END, char_limit = CASE WHEN $7 THEN $8::int ELSE char_limit END,
       status = $9, edited = edited OR $10, missing = CASE WHEN $10 AND $11 THEN '[]'::jsonb ELSE missing END, updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING ${ANSWER_COLS}`,
    [id, userId, answer, p.question?.slice(0, 2000) ?? null, p.word_limit !== undefined, p.word_limit ?? null, p.char_limit !== undefined, p.char_limit ?? null, status, p.answer !== undefined, !!answer.trim()]
  );
  await query("UPDATE app_answer_sets SET updated_at = now() WHERE id = $1 AND user_id = $2", [cur.set_id, userId]);
  return a;
}

export async function saveGenerated(userId: number, id: number, r: AnswerOutput) {
  const docIds = [...new Set(r.citations.map((c) => c.documentId).filter((x): x is number => !!x))];
  const [a] = await query(
    `UPDATE app_answers SET answer = $3, intent = $4, status = $5, missing = $6, warnings = $7, citations = $8, document_ids = $9, edited = false, updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING ${ANSWER_COLS}`,
    [id, userId, r.answer, r.intent, r.status, JSON.stringify(r.missing), JSON.stringify(r.warnings), JSON.stringify(r.citations), docIds]
  );
  if (a) await query("UPDATE app_answer_sets SET updated_at = now() WHERE id = $1 AND user_id = $2", [a.set_id, userId]);
  return a;
}

export const limitsOf = (a: { word_limit: number | null; char_limit: number | null }): Limits => ({ words: a.word_limit, chars: a.char_limit });
