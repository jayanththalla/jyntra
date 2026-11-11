// Orchestration for interview v2. Routes stay thin: they authenticate, rate-limit and call these functions with the user.
// The model call is injected (`llm`), so everything is testable with a stub and no credentials.
import type { AppUser } from "@/lib/users";
import { completeText, AiError, configuredProviders } from "@/lib/ai/outreach";
import { depsFromEnv } from "@/lib/ai/service";
import { MIN_ANSWER_CHARS, obviousNonAnswer, irrelevantFeedback, type Question } from "./index";
import { RubricError, buildRubricPrompt, parseRubricEvaluation, practiceDecision, rubricKindFor, toFeedback, RUBRIC_VERSION, type RubricResult } from "./rubric";
import { buildEnglishPrompt, parseEnglishAssessment, compareProgress, progressPoint, EnglishError, MIN_ANSWERS } from "./english";
import { QUESTION_BANK, gradeWritten, publicQuestion, pickQuestions, validateGeneratedQuestion, buildGenerationPrompt, writtenSummary, GeneratedQuestionError, WRITTEN_CATEGORIES, type WrittenCategory, type WrittenQuestion, type Difficulty, type GradeResult } from "./written";
import { SQL_PROBLEMS, getProblem, gradeSql, publicProblem } from "./sql-problems";
import { runSelect } from "./sql-sandbox";
import { englishHistory, getState, savedAnswers, saveEnglish, saveRubricAnswer, saveWritten } from "./sessions-v2";
import { query } from "@/lib/database";

export type Llm = (prompt: string) => Promise<string>;
export const defaultLlm = (): Llm => { const d = depsFromEnv(); return async (p) => (await completeText(p, d)).text; };
export const llmConfigured = () => configuredProviders(depsFromEnv()).length > 0;

export interface Result { status: number; body: Record<string, unknown> }
const bad = (error: string, message?: string, status = 400): Result => ({ status, body: { ok: false, error, ...(message ? { message } : {}) } });
const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 2_147_483_647;
const aiFail = (e: unknown): Result => {
  if (e instanceof AiError) return { status: e.code === "rate_limited" ? 429 : e.code === "timeout" ? 504 : 503, body: { ok: false, error: e.code, message: e.message, retryable: e.retryable } };
  return { status: 502, body: { ok: false, error: "bad_output", message: "The AI's reply could not be used.", retryable: true } };
};

/**
 * Scores one answer with the v2 rubric and stores it. If the model's reply cannot be validated, NOTHING is stored and NO score is
 * invented: the response is a retryable error and the client keeps the candidate's transcript for the retry button.
 */
export async function evaluateAnswer(user: AppUser, b: Record<string, unknown>, llm: Llm | null = llmConfigured() ? defaultLlm() : null): Promise<Result> {
  if (!isId(b.session_id) || typeof b.question_id !== "string") return bad("invalid_request");
  const answer = typeof b.answer === "string" ? b.answer.trim().slice(0, 4000) : "";
  if (answer.length < MIN_ANSWER_CHARS) return bad("answer_too_short", "Add a little more detail before submitting.");
  const s = await getState(user.id, b.session_id);
  if (!s) return bad("not_found", undefined, 404);
  if (s.status !== "active") return bad("session_not_active", s.status === "paused" ? "This interview is paused. Resume it to continue." : "This interview has ended.", 409);
  const q = (s.questions as Question[]).find((x) => x.id === b.question_id);
  if (!q) return bad("unknown_question", undefined, 404);
  const attempt = typeof b.attempt === "number" ? Math.max(1, Math.min(10, Math.round(b.attempt))) : 1;
  const spoken = b.input_mode === "voice" || b.input_mode === "realtime";
  const kind = rubricKindFor(s.type, q.written === true);
  const meta = { inputMode: (spoken ? b.input_mode : "text") as "voice" | "realtime" | "text", edited: b.edited === true };

  let r: RubricResult;
  const gate = obviousNonAnswer(answer);
  if (gate) r = { version: RUBRIC_VERSION, kind, overall: 0, relevant: false, communication: null, verdict: gate + " Scored 0.", components: [], strengths: [], improvements: irrelevantFeedback(gate).improvements, structure: irrelevantFeedback(gate).structure, followUp: "" };
  else {
    if (!llm) return { status: 200, body: { ok: false, error: "not_configured", message: "The AI evaluator isn't set up on this server (no GROQ_API_KEY or GEMINI_API_KEY). Your answer is kept; nothing was scored.", answer } };
    try { r = parseRubricEvaluation(await llm(buildRubricPrompt({ kind, question: q.text, answer, level: s.level, focus: q.focus, spoken })), kind, answer, { spoken }); }
    catch (e) {
      if (e instanceof RubricError) return { status: 502, body: { ok: false, error: "evaluation_failed", message: "The evaluation could not be validated, so no score was given. Your answer is kept: try again.", retryable: true, answer } };
      return { ...aiFail(e), body: { ...aiFail(e).body, answer } };
    }
  }
  const fb = toFeedback(r);
  await saveRubricAnswer(user.id, s.id, { id: q.id, text: q.text, written: q.written === true }, attempt, answer, r, fb, meta);
  return { status: 200, body: { ok: true, feedback: fb, rubric: { version: r.version, kind: r.kind, overall: r.overall, components: r.components, communication: r.communication }, decision: s.mode === "practice" ? practiceDecision(r.overall, attempt) : null } };
}

/** Spoken-English assessment from the session's own saved answers. Needs enough evidence for a level (see english.ts). */
export async function assessEnglish(user: AppUser, sessionId: unknown, speakingSeconds: unknown, llm: Llm | null = llmConfigured() ? defaultLlm() : null): Promise<Result> {
  if (!isId(sessionId)) return bad("invalid_request");
  const s = await getState(user.id, sessionId);
  if (!s) return bad("not_found", undefined, 404);
  const rows = (await savedAnswers(user.id, sessionId)).filter((a) => !a.written);
  // Latest attempt per question: the user's final wording.
  const latest = new Map<string, string>(); for (const a of rows) latest.set(a.question_id, a.answer);
  const answers = [...latest.values()];
  if (answers.length === 0) return bad("no_answers", "There are no answers to assess yet.", 409);
  if (!llm) return { status: 200, body: { ok: false, error: "not_configured", message: "The AI evaluator isn't set up on this server." } };
  try {
    const secs = typeof speakingSeconds === "number" && speakingSeconds > 0 && speakingSeconds < 7200 ? speakingSeconds : null;
    const e = parseEnglishAssessment(await llm(buildEnglishPrompt(answers)), answers, { speakingSeconds: secs });
    await saveEnglish(user.id, sessionId, e);
    const progress = compareProgress(await englishHistory(user.id, sessionId), progressPoint(e));
    return { status: 200, body: { ok: true, assessment: e, progress, minAnswers: MIN_ANSWERS } };
  } catch (e) {
    if (e instanceof EnglishError) return { status: 502, body: { ok: false, error: "evaluation_failed", message: "The English assessment could not be validated. Try again.", retryable: true } };
    return aiFail(e);
  }
}

// ---------------------------------------- written tests ----------------------------------------
async function findQuestion(id: string): Promise<WrittenQuestion | null> {
  const bank = QUESTION_BANK.find((q) => q.id === id); if (bank) return bank;
  const r = (await query<{ definition: WrittenQuestion }>("SELECT definition FROM written_test_questions WHERE id=$1", [id]))[0];
  return r?.definition ?? null;
}
const isCategory = (v: unknown): v is WrittenCategory => typeof v === "string" && (WRITTEN_CATEGORIES as readonly string[]).includes(v);

export async function writtenStart(user: AppUser, b: Record<string, unknown>, llm: Llm | null = llmConfigured() ? defaultLlm() : null): Promise<Result> {
  const cats = Array.isArray(b.categories) ? b.categories.filter(isCategory) : [];
  const count = typeof b.count === "number" ? Math.max(1, Math.min(15, Math.round(b.count))) : 5;
  const difficulty = (["easy", "medium", "hard"] as const).includes(b.difficulty as Difficulty) ? (b.difficulty as Difficulty) : undefined;
  let qs = pickQuestions({ categories: cats, count, difficulty });
  const notes: string[] = [];
  if (b.include_ai === true) {
    if (!llm) notes.push("AI-generated questions are unavailable (no AI key configured); bank questions only.");
    else {
      const cat = cats[0] ?? "DSA"; const diff = difficulty ?? "medium";
      try {
        const q = validateGeneratedQuestion(JSON.parse(((await llm(buildGenerationPrompt(cat, diff, "single", qs.map((x) => x.prompt)))).match(/\{[\s\S]*\}/) ?? [""])[0]), { category: cat, difficulty: diff });
        await query("INSERT INTO written_test_questions (id, source, category, kind, difficulty, definition) VALUES ($1,'ai',$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO NOTHING", [q.id, q.category, q.kind, q.difficulty, JSON.stringify(q)]);
        qs = [...qs.slice(0, Math.max(0, count - 1)), q];
      } catch (e) { notes.push(e instanceof GeneratedQuestionError || e instanceof SyntaxError ? "An AI-generated question failed validation and was left out." : "AI question generation failed; bank questions only."); }
    }
  }
  if (!qs.length) return bad("no_questions", "No questions match those filters.", 404);
  return { status: 200, body: { ok: true, questions: qs.map(publicQuestion), notes, startedAt: new Date().toISOString() } };
}

export async function writtenSubmit(user: AppUser, b: Record<string, unknown>): Promise<Result> {
  if (typeof b.question_id !== "string") return bad("invalid_request");
  const q = await findQuestion(b.question_id);
  if (!q) return bad("unknown_question", undefined, 404);
  const choice = Array.isArray(b.choice) ? b.choice.filter((x): x is string => typeof x === "string").slice(0, 6) : undefined;
  const text = typeof b.text === "string" ? b.text.slice(0, 3000) : undefined;
  const sessionId = isId(b.session_id) ? b.session_id : null;
  if (sessionId) { const s = await getState(user.id, sessionId); if (!s) return bad("not_found", undefined, 404); if (s.status !== "active") return bad("session_not_active", undefined, 409); }
  const g = gradeWritten(q, { choice, text }, { timedOut: b.timed_out === true });
  await query("INSERT INTO written_test_attempts (user_id, session_id, question_id, category, response, correct, score, detail) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)", [user.id, sessionId, q.id, q.category, JSON.stringify({ choice, text }), g.correct, g.score, JSON.stringify({ kind: q.kind, source: q.source, difficulty: q.difficulty })]);
  return { status: 200, body: { ok: true, result: g } };
}

export async function writtenFinish(user: AppUser, sessionId: unknown): Promise<Result> {
  if (!isId(sessionId)) return bad("invalid_request");
  if (!(await getState(user.id, sessionId))) return bad("not_found", undefined, 404);
  const rows = await query<{ question_id: string; category: string; correct: boolean; score: number; detail: { kind: string; source: "bank" | "ai"; difficulty: Difficulty } }>("SELECT DISTINCT ON (question_id) question_id, category, correct, score, detail FROM written_test_attempts WHERE user_id=$1 AND session_id=$2 ORDER BY question_id, id DESC", [user.id, sessionId]);
  const results = rows.map((r) => ({ questionId: r.question_id, category: r.category as WrittenCategory, kind: r.detail.kind as GradeResult["kind"], source: r.detail.source, difficulty: r.detail.difficulty, correct: !!r.correct, score: r.score, explanation: "" }));
  const sql = rows.filter((r) => r.category === "SQL" && r.detail.kind === "sql");
  const summary = { ...writtenSummary(results), ...(sql.length ? { sql: { answered: sql.length, score: Math.round(sql.reduce((a, r) => a + r.score, 0) / sql.length) } } : {}) };
  await saveWritten(user.id, sessionId, summary);
  return { status: 200, body: { ok: true, summary } };
}

// ---------------------------------------- SQL ----------------------------------------
export function sqlList(): Result { return { status: 200, body: { ok: true, problems: SQL_PROBLEMS.map((p) => ({ id: p.id, title: p.title, topic: p.topic, difficulty: p.difficulty })) } }; }
export function sqlProblem(id: unknown): Result { const p = typeof id === "string" ? getProblem(id) : undefined; return p ? { status: 200, body: { ok: true, problem: publicProblem(p) } } : bad("unknown_problem", undefined, 404); }
export async function sqlRun(b: Record<string, unknown>): Promise<Result> {
  const p = typeof b.problem_id === "string" ? getProblem(b.problem_id) : undefined;
  if (!p || typeof b.sql !== "string") return bad("invalid_request");
  const { SCHEMA_TEXT } = await import("./sql-problems");
  const ex = publicProblem(p);
  const run = await runSelect(b.sql, `${SCHEMA_TEXT}\n${ex.exampleSetup}`);
  return { status: 200, body: { ok: true, run } };
}
export async function sqlGrade(user: AppUser, b: Record<string, unknown>): Promise<Result> {
  const p = typeof b.problem_id === "string" ? getProblem(b.problem_id) : undefined;
  if (!p || typeof b.sql !== "string") return bad("invalid_request");
  const sessionId = isId(b.session_id) ? b.session_id : null;
  if (sessionId) { const s = await getState(user.id, sessionId); if (!s) return bad("not_found", undefined, 404); if (s.status !== "active") return bad("session_not_active", undefined, 409); }
  const g = await gradeSql(p, b.sql);
  await query("INSERT INTO written_test_attempts (user_id, session_id, question_id, category, response, correct, score, detail) VALUES ($1,$2,$3,'SQL',$4::jsonb,$5,$6,$7::jsonb)", [user.id, sessionId, p.id, JSON.stringify({ text: b.sql.slice(0, 4000) }), g.correct, g.score, JSON.stringify({ kind: "sql", source: "bank", difficulty: p.difficulty, passed: g.passed, total: g.total, engine: g.engine })]);
  return { status: 200, body: { ok: true, grade: g } };
}
