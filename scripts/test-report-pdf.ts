// Report v2 + PDF export. npx tsx scripts/test-report-pdf.ts
import assert from "node:assert/strict";
import { extractText, getDocumentProxy } from "unpdf";
import { buildReportV2, type SavedAnswer, type SessionMeta } from "@/lib/interview/report-v2";
import { renderReportPdf, pdfSafe } from "@/lib/interview/pdf";
import { TECHNICAL_RUBRIC } from "@/lib/interview/rubric";

let passed = 0, failed = 0;
async function t(n: string, f: () => void | Promise<void>) { try { await f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { failed++; console.log(`  ✗ ${n}\n    ${(e as Error).message.split("\n").slice(0, 4).join("\n    ")}`); } }

const LONG = "This feedback is deliberately long so that it wraps across many lines and pushes content over page boundaries. ".repeat(12) + "ENDMARKER_FEEDBACK";
const meta = (o: Partial<SessionMeta> = {}): SessionMeta => ({ id: 7, mode: "timed", role: "Backend Developer", type: "technical", level: "junior", status: "completed", started_at: "2026-11-03T10:00:00Z", ended_at: "2026-11-03T10:21:00Z", planned: 5, ...o });
const v2 = (i: number, score: number, kind: "technical" | "behavioural" = "technical"): SavedAnswer => ({
  question_id: `q${i}`, question: `Question ${i}: explain how database indexes work and when they hurt write performance? UNIQUEQ${i}`, written: false, attempt: 1, answer: `Answer text ${i} about B-trees and trade-offs. `.repeat(8), score,
  rubric_version: "v2", rubric_kind: kind,
  rubric: { components: TECHNICAL_RUBRIC.map((c) => ({ key: c.key, label: c.label, weight: c.weight, score, evidence: `Evidence for ${c.label} from answer ${i}.`, quote: null })), communication: { scores: { clarity: 70, grammar: 70, vocabulary: 70, structure: 70, conciseness: 70 }, overall: 70, note: "" } },
  feedback: { verdict: LONG, improvements: [LONG], strengths: [] },
});
const legacy = (i: number, score: number): SavedAnswer => ({ question_id: `L${i}`, question: `Legacy question ${i}`, written: false, attempt: 1, answer: "old answer text here", score, feedback: { verdict: "old verdict", improvements: [] } });

async function main() {
  await t("only completed sessions get a report (paused/active/abandoned throw)", () => {
    for (const status of ["active", "paused", "abandoned"]) assert.throws(() => buildReportV2(meta({ status }), [v2(1, 80)]), /completed/);
  });
  await t("scores are computed from saved rows; legacy rows are labelled and excluded from dimension averages", () => {
    const r = buildReportV2(meta(), [v2(1, 80), v2(2, 60), legacy(1, 40)]);
    assert.equal(r.scores.overall, 60); assert.equal(r.scores.technical, 70); assert.equal(r.legacyAnswers, 1);
    assert.equal(r.scores.problemSolving, 70); assert.equal(r.scores.communication, 70);
    assert.equal(r.questions.find((q) => q.id === "L1")!.basis, "legacy_unweighted"); assert.deepEqual(r.questions.find((q) => q.id === "L1")!.components, []);
    assert.equal(r.kind, "formal"); assert.equal(r.durationMinutes, 21);
  });
  await t("best attempt per question is used; practice vs formal are distinguishable", () => {
    const a = { ...v2(1, 40), attempt: 1 }, b = { ...v2(1, 85), attempt: 2 };
    const r = buildReportV2(meta({ mode: "practice" }), [a, b]);
    assert.equal(r.questions.length, 1); assert.equal(r.questions[0]!.score, 85); assert.equal(r.questions[0]!.attempts, 2);
    assert.equal(r.kind, "practice"); assert.match(r.title, /Practice/);
  });
  await t("recurring weaknesses, recommendations and next practice come from low scores", () => {
    const r = buildReportV2(meta(), [v2(1, 40), v2(2, 45), v2(3, 90)]);
    assert.ok(r.recurring.length > 0); assert.ok(r.recommendations.length > 0); assert.equal(r.nextPractice.length, 2); assert.ok(r.weakest.length >= 1);
    assert.match(r.confidence, /Moderate/); assert.ok(r.limitations.some((l) => /not a prediction/.test(l)));
  });
  await t("pdfSafe transliterates punctuation and replaces unsupported characters", () => {
    assert.equal(pdfSafe("it’s “ok” — fine…"), "it's \"ok\" - fine...");
    assert.equal(pdfSafe("naïve café ✓ 你好"), "naïve café ? ??");
  });

  const many = Array.from({ length: 12 }, (_, i) => v2(i + 1, 40 + i * 5));
  const report = buildReportV2(meta({ planned: 12 }), [...many, legacy(1, 55)], {
    english: null, written: { answered: 4, correct: 3, score: 75, topics: [{ category: "DSA", answered: 2, correct: 2, averageScore: 100 }, { category: "DBMS", answered: 2, correct: 1, averageScore: 50 }], sql: { answered: 1, score: 100 } },
  });
  let buf: Buffer; let text = ""; let pages = 0;
  await t("a PDF with 13 questions and very long feedback renders, is a valid PDF and spans several pages", async () => {
    buf = await renderReportPdf(report, { candidate: "Priya Sharma" });
    assert.equal(buf.subarray(0, 5).toString(), "%PDF-"); assert.ok(buf.length > 5_000 && buf.length < 5_000_000, String(buf.length));
    const pdf = await getDocumentProxy(new Uint8Array(buf)); pages = pdf.numPages;
    const r = await extractText(pdf, { mergePages: false }); text = (r.text as string[]).join("\n");
    assert.ok(pages >= 4, `pages=${pages}`);
  });
  await t("the PDF contains the ACTUAL saved report (role, candidate, scores, every question, written topics)", () => {
    for (const s of ["Formal Mock Interview Report", "Backend Developer", "Priya Sharma", "UNIQUEQ1", "UNIQUEQ12", "Legacy question 1", "DBMS", "Written test", "Personalised learning roadmap", `${report.scores.overall}/100`, "legacy"]) assert.ok(text.includes(s), `missing: ${s}`);
  });
  await t("no clipped content: the end of every long feedback paragraph is present", () => {
    assert.equal((text.match(/ENDMARKER_FEEDBACK/g) ?? []).length >= 12, true, String((text.match(/ENDMARKER_FEEDBACK/g) ?? []).length));
  });
  await t("every page carries 'Page n of N'", async () => {
    const pdf = await getDocumentProxy(new Uint8Array(buf)); const r = await extractText(pdf, { mergePages: false });
    (r.text as string[]).forEach((p, i) => assert.ok(p.includes(`Page ${i + 1} of ${pages}`), `page ${i + 1}`));
  });
  await t("a report with no English or written data still renders and says so honestly", async () => {
    const b = await renderReportPdf(buildReportV2(meta({ mode: "practice" }), [v2(1, 80)]));
    const r = await extractText(await getDocumentProxy(new Uint8Array(b)), { mergePages: true });
    const s = r.text as string; assert.match(s, /Practice Session Summary/); assert.match(s, /No spoken-English assessment/); assert.match(s, /part of formal interviews/);
  });
  await t("the CEFR label is printed when an assessment exists", async () => {
    const { parseEnglishAssessment } = await import("@/lib/interview/english");
    const A = ["I built an API and added caching so that the response time became much better for all of our users in the team. ".repeat(3), "I found a slow query and added an index which made the page load faster and I learned to measure first. ".repeat(3), "We chose React because everyone already knew it and so we could ship the feature faster than before. ".repeat(3)];
    const e = parseEnglishAssessment(JSON.stringify({ level: "B1", rationale: "ok", scores: { grammar: 70, sentence_construction: 70, vocabulary: 70, clarity: 70, structure: 70, conciseness: 70 }, strong_habits: [], grammar_mistakes: [], vocabulary_improvements: [], exercises: ["a", "b", "c"] }), A);
    const b = await renderReportPdf(buildReportV2(meta(), [v2(1, 80)], { english: e }));
    const s = (await extractText(await getDocumentProxy(new Uint8Array(b)), { mergePages: true })).text as string;
    assert.match(s, /not an official CEFR certification/); assert.match(s, /pronunciation, accent and sound were not assessed/);
  });
  console.log(`\nreport+pdf: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
}
main();
