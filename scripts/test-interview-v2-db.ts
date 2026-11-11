// Interview v2 service layer on a REAL PostgreSQL (throw-away database) with a stubbed model. DATABASE_URL=postgres://… npx tsx scripts/test-interview-v2-db.ts
import assert from "node:assert/strict";
import { Client } from "pg";
const base = process.env.DATABASE_URL;
if (!base) { console.log("SKIPPED: DATABASE_URL is not set."); process.exit(0); }
let passed = 0, failed = 0;
async function t(n: string, f: () => Promise<void>) { try { await f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { failed++; console.log(`  ✗ ${n}\n    ${(e as Error).message.split("\n").slice(0, 5).join("\n    ")}`); } }

async function main() {
  const dbName = `jyntra_iv2_${process.pid}_${Date.now() % 100000}`;
  const admin = new Client({ connectionString: base }); await admin.connect(); admin.on("error", () => {});
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(base!); u.pathname = "/" + dbName; process.env.DATABASE_URL = u.toString();
  const { query, pool, ready } = await import("@/lib/database"); pool().on("error", () => {});
  await ready();
  const users = await import("@/lib/users");
  const S = await import("@/lib/interview/sessions-v2");
  const V = await import("@/lib/interview/service-v2");
  const { TECHNICAL_RUBRIC } = await import("@/lib/interview/rubric");
  const mk = async (name: string) => (await users.createUser({ name, skills: ["Python"], target_roles: ["Backend"], tech_experience_years: 2, projects: [] } as any)).user;
  const A = await mk("A"), B = await mk("B");
  const Q = [{ id: "q1", text: "Explain how a hash table handles collisions and why that matters?", focus: "chaining, probing" }, { id: "q2", text: "Describe how you would debug a slow database query in production?", focus: "explain, indexes" }, { id: "q3", text: "How does a B-tree index speed up lookups in a database?", focus: "structure" }];
  const ANS = "A hash table maps keys to buckets, and when two keys land in the same bucket we have a collision. Chaining stores a linked list per bucket, while open addressing probes for another free slot, so lookups stay close to constant time.";
  const goodJson = (quote = "chaining stores a linked list per bucket") => JSON.stringify({ relevant: true, verdict: "Good explanation.", strengths: ["clear"], improvements: ["mention load factor"], structure: "Define, strategies, trade-offs.", followUp: "What is the load factor?", components: Object.fromEntries(TECHNICAL_RUBRIC.map((c) => [c.key, { score: 80, evidence: "Names both strategies.", quote }])), communication: { clarity: 80, grammar: 80, vocabulary: 75, structure: 80, conciseness: 70, note: "Clear." } });
  let llmCalls = 0; let llmOut = goodJson;
  const llm = async () => { llmCalls++; return llmOut(); };

  console.log("migration");
  await t("migration is idempotent and old rows keep their data, marked legacy (not rescaled, not rewritten)", async () => {
    const [s] = await query<{ id: number }>("INSERT INTO interview_sessions (user_id, mode, type, level, questions, status) VALUES ($1,'timed','technical','junior','[]','completed') RETURNING id", [A.id]);
    await query("INSERT INTO interview_answers (session_id, user_id, question_id, question, answer, score, feedback) VALUES ($1,$2,'old','Old question text here?','old answer',62,'{\"verdict\":\"old\"}')", [s!.id, A.id]);
    await ready(); await query("SELECT 1");
    const [r] = await query<any>("SELECT score, rubric_version, rubric FROM interview_answers WHERE question_id='old'");
    assert.equal(r.score, 62); assert.equal(r.rubric_version, "legacy"); assert.equal(r.rubric, null);
    const [ss] = await query<any>("SELECT report_version FROM interview_sessions WHERE id=$1", [s!.id]); assert.equal(ss.report_version, 1);
    // re-running the migration file twice more must not fail
    const fs = await import("node:fs"); const sql = fs.readFileSync("lib/database/interview-v2.sql", "utf8"); await query(sql); await query(sql);
  });
  await t("score CHECK still holds 0..100 and 'paused' is an allowed status", async () => {
    await assert.rejects(query("INSERT INTO interview_answers (session_id, user_id, question_id, question, answer, score, feedback) SELECT id,$1,'x','y','z',101,'{}' FROM interview_sessions LIMIT 1", [A.id]));
    const [s] = await query<{ id: number }>("INSERT INTO interview_sessions (user_id, mode, type, level, questions, status) VALUES ($1,'timed','technical','junior','[]','paused') RETURNING id", [A.id]); assert.ok(s);
    await query("DELETE FROM interview_sessions WHERE id=$1", [s.id]);
  });

  console.log("formal session, pause/resume, scoring");
  await query("DELETE FROM interview_sessions");
  let sid = 0;
  await t("a formal session is created with a fixed plan (10/20/30 min = 3/5/8 main questions)", async () => {
    assert.deepEqual([S.FORMAL_PLAN[10].mainQuestions, S.FORMAL_PLAN[20].mainQuestions, S.FORMAL_PLAN[30].mainQuestions], [3, 5, 8]);
    sid = await S.createFormalSession(A.id, { type: "technical", level: "junior", role: "Backend Developer", minutes: 10, questions: Q });
    const o = await S.openSession(A.id); assert.equal(o?.id, sid); assert.equal(o?.status, "active"); assert.equal(o?.target_minutes, 10);
    assert.equal(await S.openSession(B.id), null, "another user sees nothing");
  });
  await t("a valid answer is scored with the weighted rubric (0-100), stored as v2, and returned in the existing Feedback shape", async () => {
    const r = await V.evaluateAnswer(A, { session_id: sid, question_id: "q1", answer: ANS, input_mode: "voice" }, llm);
    assert.equal(r.status, 200, JSON.stringify(r.body)); const b = r.body as any;
    assert.equal(b.feedback.score, 80); assert.equal(b.rubric.version, "v2"); assert.equal(b.rubric.components.length, 5); assert.ok(b.rubric.communication.overall > 0); assert.equal(b.decision, null, "formal mode has no practice gate");
    const [row] = await query<any>("SELECT score, rubric_version, rubric_kind, input_mode FROM interview_answers WHERE session_id=$1", [sid]);
    assert.deepEqual([row.score, row.rubric_version, row.rubric_kind, row.input_mode], [80, "v2", "technical", "voice"]);
  });
  await t("when the model output is unusable NOTHING is stored and NO fallback score is invented; the answer is returned for retry", async () => {
    for (const bad of [() => "I cannot help", () => goodJson("I have ten years of Kubernetes experience at Google"), () => "{ broken"]) {
      llmOut = bad; const before = (await query("SELECT 1 FROM interview_answers WHERE session_id=$1", [sid])).length;
      const r = await V.evaluateAnswer(A, { session_id: sid, question_id: "q2", answer: ANS }, llm); const b = r.body as any;
      assert.equal(r.status, 502); assert.equal(b.error, "evaluation_failed"); assert.equal(b.retryable, true); assert.equal(b.answer, ANS.trim()); assert.ok(!("feedback" in b) && !("score" in b));
      assert.equal((await query("SELECT 1 FROM interview_answers WHERE session_id=$1", [sid])).length, before);
    }
    llmOut = goodJson;
  });
  await t("no AI key: the answer is kept, nothing is scored, and the message says so (not a 70/100 placeholder)", async () => {
    const r = await V.evaluateAnswer(A, { session_id: sid, question_id: "q2", answer: ANS }, null); const b = r.body as any;
    assert.equal(b.ok, false); assert.equal(b.error, "not_configured"); assert.ok(!("feedback" in b));
  });
  await t("obvious non-answers score 0 locally without calling the model", async () => {
    const before = llmCalls; const r = await V.evaluateAnswer(A, { session_id: sid, question_id: "q3", answer: "asdf asdf asdf asdf asdf asdf asdf" }, llm);
    assert.equal((r.body as any).feedback.score, 0); assert.equal(llmCalls, before);
  });
  await t("another user cannot evaluate into, pause, resume or complete this session (404 / not_active)", async () => {
    assert.equal((await V.evaluateAnswer(B, { session_id: sid, question_id: "q1", answer: ANS }, llm)).status, 404);
    assert.equal(await S.pauseSession(B.id, sid), null); assert.equal(await S.completeSessionV2(B.id, sid), null); assert.equal(await S.getState(B.id, sid), null);
  });
  await t("a question that is not in this session's plan is rejected", async () => { assert.equal((await V.evaluateAnswer(A, { session_id: sid, question_id: "zzz", answer: ANS }, llm)).status, 404); });
  await t("pause stops the clock and blocks answers; resume continues; a paused session survives a 'refresh' (openSession)", async () => {
    await query("UPDATE interview_sessions SET active_since = now() - interval '90 seconds' WHERE id=$1", [sid]);
    const p = await S.pauseSession(A.id, sid); assert.equal(p?.status, "paused"); assert.ok(p!.elapsed_seconds >= 89 && p!.elapsed_seconds <= 95, String(p!.elapsed_seconds));
    assert.equal((await S.openSession(A.id))?.status, "paused");
    const blocked = await V.evaluateAnswer(A, { session_id: sid, question_id: "q2", answer: ANS }, llm); assert.equal(blocked.status, 409); assert.equal((blocked.body as any).error, "session_not_active");
    assert.equal(await S.pauseSession(A.id, sid), null, "cannot pause twice");
    await new Promise((r) => setTimeout(r, 1100));
    const r = await S.resumeSession(A.id, sid); assert.equal(r?.status, "active"); assert.ok(r!.elapsed_seconds <= 95, "time while paused was not counted");
  });
  await t("a paused session cannot be completed, so it never appears as a completed report", async () => {
    await S.pauseSession(A.id, sid); assert.equal(await S.completeSessionV2(A.id, sid), null); assert.equal(await S.getStoredReport(A.id, sid), null);
    await S.resumeSession(A.id, sid);
  });

  console.log("written + SQL + English");
  await t("written MCQ: public questions hide answers; submission returns the answer; attempts are stored; unknown ids 404", async () => {
    const st = await V.writtenStart(A, { categories: ["DSA"], count: 2 }, null); const qs = (st.body as any).questions;
    assert.equal(qs.length, 2); assert.ok(!JSON.stringify(qs).includes("explanation") && !JSON.stringify(qs).includes('"correct"'));
    const r = await V.writtenSubmit(A, { question_id: "dsa-1", choice: ["b"], session_id: sid }); assert.equal((r.body as any).result.correct, true); assert.deepEqual((r.body as any).result.correctAnswer, ["b"]);
    await V.writtenSubmit(A, { question_id: "dbms-1", choice: ["a"], session_id: sid });
    assert.equal((await V.writtenSubmit(A, { question_id: "nope", choice: ["a"] })).status, 404);
    assert.equal((await V.writtenSubmit(B, { question_id: "dsa-1", choice: ["b"], session_id: sid })).status, 404, "another user's session");
  });
  await t("AI question generation: a valid one is stored with source 'ai'; an invalid one is dropped with a note (nothing fabricated)", async () => {
    const good = JSON.stringify({ kind: "single", prompt: "Which HTTP status code means the resource was created?", options: ["200", "201", "204", "301"], correct: ["b"], explanation: "201 Created is returned when a new resource is created by the request." });
    const ok = await V.writtenStart(A, { categories: ["Computer networks"], count: 2, include_ai: true }, async () => good); const q = ((ok.body as any).questions as any[]).find((x) => x.source === "ai"); assert.ok(q);
    assert.equal((await V.writtenSubmit(A, { question_id: q.id, choice: ["b"] })).status, 200);
    const bad = await V.writtenStart(A, { categories: ["DSA"], count: 2, include_ai: true }, async () => "{\"kind\":\"single\",\"prompt\":\"x\"}"); assert.ok((bad.body as any).notes[0] && (bad.body as any).questions.every((x: any) => x.source === "bank"));
    const none = await V.writtenStart(A, { count: 1, include_ai: true }, null); assert.match((none.body as any).notes[0], /unavailable/);
  });
  await t("SQL: a correct query is graded in the sandbox and stored; a rejected write is refused; the app database is untouched", async () => {
    const g = await V.sqlGrade(A, { problem_id: "sql-filter-high-paid", sql: "SELECT name FROM employees WHERE salary > 60000 ORDER BY salary DESC, name", session_id: sid }); const gr = (g.body as any).grade;
    assert.equal(gr.correct, true); assert.equal(gr.engine, "sqlite");
    const w = await V.sqlGrade(A, { problem_id: "sql-aggregates", sql: "DROP TABLE users", session_id: sid }); assert.equal((w.body as any).grade.error.kind, "rejected");
    assert.ok((await query("SELECT 1 FROM users LIMIT 1")).length >= 0, "users table still exists");
    const run = await V.sqlRun({ problem_id: "sql-aggregates", sql: "SELECT COUNT(*) FROM employees" }); assert.deepEqual((run.body as any).run.rows, [[8]]);
    assert.equal((await V.sqlProblem("nope")).status, 404);
    assert.ok(!JSON.stringify((await V.sqlProblem("sql-aggregates")).body).includes("SUM(salary), MAX"), "solution not in the public problem");
  });
  await t("written finish stores a topic-wise summary on the session (including SQL)", async () => {
    const f = await V.writtenFinish(A, sid); const s = (f.body as any).summary; assert.ok(s.answered >= 3); assert.ok(s.topics.length >= 2); assert.ok(s.sql.answered >= 1);
    assert.equal((await V.writtenFinish(B, sid)).status, 404);
  });
  await t("English assessment: stored on the session; with too little text the level is 'insufficient' (no confident CEFR from one short answer)", async () => {
    const eng = JSON.stringify({ level: "C1", rationale: "x", scores: { grammar: 80, sentence_construction: 80, vocabulary: 80, clarity: 80, structure: 80, conciseness: 80 }, exercises: ["a", "b", "c"] });
    const r = await V.assessEnglish(A, sid, null, async () => eng); const b = r.body as any;
    assert.equal(r.status, 200); assert.equal(b.assessment.level, "insufficient"); assert.match(b.progress.notes[0], /first assessed/);
    assert.equal((await V.assessEnglish(B, sid, null, async () => eng)).status, 404);
    const [row] = await query<any>("SELECT english FROM interview_sessions WHERE id=$1", [sid]); assert.equal(row.english.label, "AI-estimated practice level — not an official CEFR certification.");
  });

  console.log("completion, reports, history");
  await t("completing builds the v2 report from SAVED rows and stores it; PDF-able; a second completion is refused", async () => {
    const r = await S.completeSessionV2(A.id, sid); assert.ok(r); assert.equal(r!.kind, "formal"); assert.equal(r!.questionsAnswered, 2); assert.equal(r!.scores.overall, 40 /* q1=80, q3=0 */); assert.ok(r!.written && r!.english);
    const stored = await S.getStoredReport(A.id, sid); assert.equal(stored?.version, 2);
    const { renderReportPdf } = await import("@/lib/interview/pdf"); const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await renderReportPdf((stored as any).report, { candidate: "A" }); const text = (await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true })).text as string;
    assert.ok(text.includes("hash table") && text.includes("Backend Developer") && text.includes("40/100"), "PDF holds the saved data");
    assert.equal(await S.completeSessionV2(A.id, sid), null); assert.equal(await S.getStoredReport(B.id, sid), null, "another user cannot read the report");
  });
  await t("historical (version 1) reports are returned exactly as saved and are not converted", async () => {
    const [s] = await query<{ id: number }>("INSERT INTO interview_sessions (user_id, mode, type, level, questions, status, report) VALUES ($1,'timed','technical','junior','[]','completed','{\"overall\":58,\"answered\":3}') RETURNING id", [A.id]);
    const r = await S.getStoredReport(A.id, s!.id); assert.equal(r?.version, 1); assert.deepEqual(r?.report, { overall: 58, answered: 3 });
  });
  await t("English progress history only counts completed sessions", async () => {
    const h = await S.englishHistory(A.id); assert.equal(h.length, 1); assert.equal(h[0]!.level, "insufficient");
  });

  console.log("resume profiles");
  await t("profiles are scoped to their owner; the Atlas resume is reused instead of a second upload", async () => {
    const id = await S.saveResumeProfile(A.id, { skills: ["Python"], projects: [] }, "upload", true); assert.ok(await S.getResumeProfile(A.id, id)); assert.equal(await S.getResumeProfile(B.id, id), null);
    const upd = await S.saveResumeProfile(B.id, { skills: ["Go"] }, "manual", true, id); assert.notEqual(upd, id, "B cannot overwrite A's profile by id");
    assert.equal(await S.atlasResumeText(B.id), null);
    const [src] = await query<{ id: number }>("INSERT INTO kb_sources (user_id, provider, label) VALUES ($1,'upload','resume') RETURNING id", [B.id]);
    await query("INSERT INTO kb_documents (user_id, source_id, provider, doc_type, external_id, title, content, content_hash) VALUES ($1,$2,'upload','resume','r1','Resume','Jane Doe\nSKILLS\nPython, Django', 'h')", [B.id, src!.id]);
    assert.match((await S.atlasResumeText(B.id))!, /Django/); assert.equal(await S.atlasResumeText(A.id), null);
  });

  await pool().end(); await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`); await admin.end();
  console.log(`\ninterview v2 db: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
}
main();
