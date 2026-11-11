// Integration tests (real PostgreSQL): interview session persistence, report building, and strict per-user isolation.
import assert from "node:assert/strict";
import { pool, query, ready } from "@/lib/database";
import { completeSession, createSession, deleteSession, getSession, listSessions, saveAnswer } from "@/lib/interview/sessions";
import { buildReport } from "@/lib/interview/report";
import type { Feedback } from "@/lib/interview";
import { harness } from "./ingestion-test-utils";

const { t, done } = harness();
const fb = (score: number, dims: [string, number][] = [], extra: Partial<Feedback> = {}): Feedback => ({ relevant: true, score, dimensions: dims.map(([name, s]) => ({ name, score: s, evidence: `evidence for ${name}` })), verdict: "v", strengths: [], improvements: ["be specific"], structure: "Context, approach, result", followUp: "", ...extra }) as Feedback;
const Q = [{ id: "q1", text: "Explain how a database index works.", focus: "x" }, { id: "q2", text: "Write a SQL query for the top 3 customers.", focus: "y", written: true }, { id: "q3", text: "Tell me about a conflict you resolved.", focus: "z" }];

async function main() {
  await ready();
  const mkUser = async (tag: string) => (await query<{ id: number }>("INSERT INTO users (token, profile) VALUES ($1,'{}') RETURNING id", [`isess-${tag}-${Date.now()}aaaa`]))[0]!.id;
  const A = await mkUser("a"), B = await mkUser("b");
  try {
    console.log("report builder (pure)");
    await t("per-question score is the BEST attempt; written score is separate; pass uses the 75 threshold", () => {
      const r = buildReport([
        { question_id: "q1", question: Q[0]!.text, written: false, attempt: 1, answer: "a", score: 40, feedback: fb(40, [["Depth", 30], ["Relevance", 60]]) },
        { question_id: "q1", question: Q[0]!.text, written: false, attempt: 2, answer: "b", score: 80, feedback: fb(80, [["Depth", 75], ["Relevance", 85]]) },
        { question_id: "q2", question: Q[1]!.text, written: true, attempt: 1, answer: "c", score: 30, feedback: fb(30, [["Depth", 20], ["Relevance", 40]]) },
      ], 3);
      assert.equal(r.answered, 2); assert.equal(r.planned, 3); assert.equal(r.overall, 55);
      assert.deepEqual(r.written, { answered: 1, score: 30 });
      const q1 = r.perQuestion.find((q) => q.id === "q1")!; assert.equal(q1.score, 80); assert.equal(q1.attempts, 2); assert.equal(q1.passed, true);
      assert.equal(r.perQuestion.find((q) => q.id === "q2")!.passed, false);
      assert.deepEqual(r.incorrect.map((q) => q.id), ["q2"]); assert.ok(r.nextPractice[0]!.includes("best so far 30/100"));
      assert.equal(r.dimensions.find((d) => d.name === "Depth")!.average, 48); // (75 + 20) / 2, from each question's best attempt
    });
    await t("recurring weakness needs 2+ answers under 60; an empty session has no overall score (never invented)", () => {
      const mk = (id: string, s: number) => ({ question_id: id, question: id, written: false, attempt: 1, answer: "x", score: s, feedback: fb(s, [["Structure", s]]) });
      assert.equal(buildReport([mk("a", 40), mk("b", 50)], 2).recurringWeaknesses.length, 1);
      assert.equal(buildReport([mk("a", 40)], 2).recurringWeaknesses.length, 0);
      const e = buildReport([], 3); assert.equal(e.overall, null); assert.equal(e.answered, 0); assert.deepEqual(e.written, { answered: 0, score: null });
    });

    console.log("persistence + isolation");
    const sid = await createSession(A, { mode: "practice", type: "technical", level: "junior", role: "Backend Engineer", questions: Q });
    await t("answers are saved only for the owner's ACTIVE session and only for questions in its plan", async () => {
      assert.equal(await saveAnswer(A, sid, { id: "q1", text: Q[0]!.text, written: false }, 1, "my answer", fb(60, [["Depth", 60]])), true);
      assert.equal(await saveAnswer(B, sid, { id: "q1", text: Q[0]!.text, written: false }, 1, "intruder", fb(100)), false); // another user
      assert.equal(await saveAnswer(A, sid, { id: "q99", text: "not in plan", written: false }, 1, "x", fb(100)), false); // question not planned
      assert.equal(await saveAnswer(A, 999999, { id: "q1", text: "x", written: false }, 1, "x", fb(100)), false); // no such session
      assert.equal(Number((await query<{ c: string }>("SELECT count(*) c FROM interview_answers WHERE session_id=$1", [sid]))[0]!.c), 1);
    });
    await t("another user cannot read, list, complete or delete the session", async () => {
      assert.equal(await getSession(B, sid), null);
      assert.equal((await listSessions(B)).some((s) => s.id === sid), false);
      assert.equal(await completeSession(B, sid), null);
      assert.equal(await deleteSession(B, sid), false);
      assert.ok(await getSession(A, sid));
    });
    await saveAnswer(A, sid, { id: "q1", text: Q[0]!.text, written: false }, 2, "better answer", fb(85, [["Depth", 85]]));
    await saveAnswer(A, sid, { id: "q2", text: Q[1]!.text, written: true }, 1, "select ...", fb(55, [["Depth", 55]]));
    await t("completing stores a report built from the stored answers, then the session is closed to new answers", async () => {
      const r = await completeSession(A, sid);
      assert.equal(r!.answered, 2); assert.equal(r!.overall, 70); assert.deepEqual(r!.written, { answered: 1, score: 55 });
      const s = await getSession(A, sid); assert.equal(s!.status, "completed"); assert.equal(s!.report!.overall, 70); assert.equal(s!.answers.length, 3);
      assert.equal(await saveAnswer(A, sid, { id: "q3", text: Q[2]!.text, written: false }, 1, "late", fb(90)), false);
      assert.equal(await completeSession(A, sid), null); // cannot be completed twice
      const h = (await listSessions(A)).find((x) => x.id === sid)!; assert.equal(h.overall, 70); assert.equal(h.answered, 2); assert.equal(h.role, "Backend Engineer");
    });
    await t("deleting a session removes its transcripts (ON DELETE CASCADE) and only for the owner", async () => {
      assert.equal(await deleteSession(A, sid), true);
      assert.equal(Number((await query<{ c: string }>("SELECT count(*) c FROM interview_answers WHERE session_id=$1", [sid]))[0]!.c), 0);
    });
  } finally {
    await query("DELETE FROM users WHERE id = ANY($1)", [[A, B]]);
    await pool().end();
  }
  done("interview sessions (database)");
}
main().catch((e) => { console.error(e); process.exit(1); });
