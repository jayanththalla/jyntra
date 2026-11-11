// Interview report v2. Deterministic and built ONLY from saved rows: answers (with their rubric), the saved spoken-English
// assessment and the saved written-test result. No model call happens here, so nothing in a report can be invented, and a report
// can be rebuilt at any time (the PDF is rendered from this object).
//  - Only COMPLETED sessions get a report. A paused or active session throws.
//  - Formal and practice reports are distinguishable (`kind`).
//  - Answers saved before rubric v2 are kept and labelled "legacy"; they count in the overall score but never contribute to
//    per-dimension averages, because they have no validated dimension scores.
import type { RubricResult } from "./rubric";
import { RUBRICS, RUBRIC_VERSION } from "./rubric";
import type { EnglishAssessment } from "./english";
import type { TopicPerformance } from "./written";
import { PASS_SCORE } from "./index";

export interface SavedAnswer {
  question_id: string; question: string; written: boolean; attempt: number; answer: string; score: number;
  rubric_version?: string | null; rubric_kind?: string | null; rubric?: Partial<RubricResult> | null;
  feedback: { verdict?: string; strengths?: string[]; improvements?: string[]; structure?: string };
}
export interface SessionMeta { id: number; mode: "practice" | "timed"; role: string | null; type: string; level: string; status: string; started_at: string; ended_at: string | null; elapsed_seconds?: number | null; planned: number }
export interface WrittenSummary { answered: number; correct: number; score: number | null; topics: TopicPerformance[]; sql?: { answered: number; score: number | null } }

export interface QuestionRow {
  id: string; question: string; answer: string; attempts: number; score: number; basis: "weighted_rubric" | "legacy_unweighted";
  kind: "technical" | "behavioural" | "legacy"; components: { label: string; weight: number; score: number; evidence: string }[];
  communication: number | null; verdict: string; improvements: string[]; passed: boolean;
}
export interface ReportV2 {
  version: 2; kind: "formal" | "practice";
  title: string; role: string; interviewType: string; level: string; date: string; durationMinutes: number | null;
  questionsPlanned: number; questionsAnswered: number;
  scores: { overall: number | null; technical: number | null; communication: number | null; problemSolving: number | null; behavioural: number | null };
  english: EnglishAssessment | null; written: WrittenSummary | null;
  questions: QuestionRow[]; strongest: QuestionRow[]; weakest: QuestionRow[];
  recurring: string[]; recommendations: string[]; nextPractice: string[];
  legacyAnswers: number; confidence: string; limitations: string[];
}

const avg = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => typeof x === "number"); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
export const REPORT_LIMITATIONS = [
  "This is a practice simulation. Scores are estimates from your answers and are not a prediction of any real interview or hiring decision.",
  "Scores come from an AI reading of your answers against a fixed rubric. They can be wrong; use them to find topics to practise, not as a verdict.",
  "Answers saved before the weighted rubric existed are labelled \"legacy\" and are not broken down by dimension.",
];

const ADVICE: Record<string, string> = {
  "Technical correctness": "Revise the core concepts behind the questions you missed, then explain them aloud without notes.",
  "Relevance": "Start each answer by restating what was asked, then answer that directly before adding detail.",
  "Depth and completeness": "Add edge cases, trade-offs and one concrete example to each answer.",
  "Problem-solving": "Practise thinking aloud: state the approach, why you chose it, and what you would try if it failed.",
  "Explanation structure": "Use a fixed shape: approach, steps, complexity or result.",
  "Situation and context": "Open with one or two sentences of specific context: where, when and why it mattered.",
  "Task clarity": "Say plainly what you personally were responsible for.",
  "Actions taken": "Use \"I\" for your own actions and keep team actions separate.",
  "Results and evidence": "End with the outcome, using a number or a concrete observation you actually have.",
  "Reflection and learning": "Close with what you learned or would do differently.",
};

export function buildReportV2(session: SessionMeta, answers: SavedAnswer[], extras: { english?: EnglishAssessment | null; written?: WrittenSummary | null } = {}): ReportV2 {
  if (session.status !== "completed") throw new Error("Only completed sessions have a report.");
  // One row per question: the best attempt (ties go to the later one).
  const byQ = new Map<string, SavedAnswer[]>();
  for (const a of answers) byQ.set(a.question_id, [...(byQ.get(a.question_id) ?? []), a]);
  const rows: QuestionRow[] = [];
  for (const [id, list] of byQ) {
    const best = list.reduce((b, x) => (x.score >= b.score ? x : b));
    const v2 = best.rubric_version === RUBRIC_VERSION && best.rubric && Array.isArray(best.rubric.components);
    const kind: QuestionRow["kind"] = v2 ? (best.rubric_kind === "behavioural" ? "behavioural" : "technical") : "legacy";
    rows.push({
      id, question: best.question, answer: best.answer, attempts: Math.max(...list.map((x) => x.attempt)), score: best.score,
      basis: v2 ? "weighted_rubric" : "legacy_unweighted", kind,
      components: v2 ? best.rubric!.components!.map((c) => ({ label: c.label, weight: c.weight, score: c.score, evidence: c.evidence })) : [],
      communication: v2 ? best.rubric!.communication?.overall ?? null : null,
      verdict: best.feedback?.verdict ?? "", improvements: best.feedback?.improvements ?? [], passed: best.score >= PASS_SCORE,
    });
  }
  const tech = rows.filter((r) => r.kind === "technical"), beh = rows.filter((r) => r.kind === "behavioural");
  const dimAvg = new Map<string, number[]>();
  for (const r of rows) for (const c of r.components) dimAvg.set(c.label, [...(dimAvg.get(c.label) ?? []), c.score]);
  const recurring = [...dimAvg.entries()].filter(([, s]) => s.length >= 2 && avg(s)! < 60).map(([label, s]) => `${label}: average ${avg(s)}/100 across ${s.length} answers`);
  const weakLabels = [...dimAvg.entries()].map(([label, s]) => [label, avg(s)!] as const).filter(([, a]) => a < 70).sort((a, b) => a[1] - b[1]).slice(0, 3);
  const recommendations = [
    ...weakLabels.map(([label]) => ADVICE[label]).filter((x): x is string => !!x),
    ...(extras.written?.topics ?? []).filter((t) => t.averageScore < 60).slice(0, 2).map((t) => `Review ${t.category}: you scored ${t.averageScore}/100 on ${t.answered} written question(s).`),
    ...(extras.english?.exercises ?? []).slice(0, 1),
  ];
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const answered = rows.length;
  const confidence = answered < 3 ? "Low: fewer than three answered questions, so the scores are rough." : answered < 5 ? "Moderate: based on a handful of answers." : "Reasonable for a practice report, but still an estimate.";
  const startMs = Date.parse(session.started_at), endMs = session.ended_at ? Date.parse(session.ended_at) : NaN;
  const durationMinutes = session.elapsed_seconds ? Math.max(1, Math.round(session.elapsed_seconds / 60)) : Number.isFinite(endMs) && Number.isFinite(startMs) ? Math.max(1, Math.round((endMs - startMs) / 60000)) : null;
  const kind = session.mode === "timed" ? "formal" : "practice";
  return {
    version: 2, kind, title: kind === "formal" ? "Formal Mock Interview Report" : "Practice Session Summary",
    role: session.role || "Not specified", interviewType: session.type, level: session.level, date: session.started_at, durationMinutes,
    questionsPlanned: session.planned, questionsAnswered: answered,
    scores: {
      overall: avg(rows.map((r) => r.score)), technical: avg(tech.map((r) => r.score)), behavioural: avg(beh.map((r) => r.score)),
      communication: avg(rows.map((r) => r.communication)),
      problemSolving: avg(tech.flatMap((r) => r.components.filter((c) => c.label === RUBRICS.technical[3]!.label).map((c) => c.score))),
    },
    english: extras.english ?? null, written: extras.written ?? null,
    questions: rows, strongest: sorted.slice(0, 2).filter((q) => q.score >= 50), weakest: [...sorted].reverse().slice(0, 2).filter((q) => q.score < PASS_SCORE),
    recurring, recommendations: [...new Set(recommendations)].slice(0, 6),
    nextPractice: rows.filter((r) => !r.passed).sort((a, b) => a.score - b.score).slice(0, 3).map((r) => `Retry: "${r.question.slice(0, 140)}" (best so far ${r.score}/100)`),
    legacyAnswers: rows.filter((r) => r.basis === "legacy_unweighted").length, confidence, limitations: [...REPORT_LIMITATIONS],
  };
}
