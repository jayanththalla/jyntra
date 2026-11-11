// Deterministic interview report built ONLY from the stored answers and their evaluations. No model call: nothing here can be
// invented, and a report can be rebuilt at any time. A question's score is the best of its attempts.
import { PASS_SCORE, type Feedback } from "./index";

export interface StoredAnswer { question_id: string; question: string; written: boolean; attempt: number; answer: string; score: number; feedback: Feedback }
export interface QuestionResult { id: string; question: string; written: boolean; attempts: number; score: number; passed: boolean; strongestDimension: string | null; weakestDimension: string | null; improvedStructure: string; improvements: string[] }
export interface InterviewReport {
  answered: number; planned: number;
  overall: number | null; written: { answered: number; score: number | null };
  dimensions: { name: string; average: number; questions: number }[];
  perQuestion: QuestionResult[];
  strongest: QuestionResult[]; weakest: QuestionResult[];
  recurringWeaknesses: string[];
  incorrect: QuestionResult[];
  reviseTopics: string[];
  nextPractice: string[];
}

const avg = (n: number[]) => (n.length ? Math.round(n.reduce((a, b) => a + b, 0) / n.length) : null);

export function buildReport(answers: StoredAnswer[], planned: number): InterviewReport {
  const byQ = new Map<string, StoredAnswer[]>();
  for (const a of answers) byQ.set(a.question_id, [...(byQ.get(a.question_id) ?? []), a]);
  const perQuestion: QuestionResult[] = [...byQ.entries()].map(([id, list]) => {
    const best = list.reduce((b, x) => (x.score >= b.score ? x : b));
    const dims = [...best.feedback.dimensions].sort((a, b) => b.score - a.score);
    return {
      id, question: best.question, written: list.some((x) => x.written), attempts: Math.max(...list.map((x) => x.attempt)), score: best.score, passed: best.score >= PASS_SCORE,
      strongestDimension: dims[0]?.name ?? null, weakestDimension: dims.length > 1 ? dims[dims.length - 1]!.name : null,
      improvedStructure: best.feedback.structure, improvements: best.feedback.improvements,
    };
  });
  const dimMap = new Map<string, number[]>();
  for (const q of byQ.values()) {
    const best = q.reduce((b, x) => (x.score >= b.score ? x : b));
    for (const d of best.feedback.dimensions) dimMap.set(d.name, [...(dimMap.get(d.name) ?? []), d.score]);
  }
  const dimensions = [...dimMap.entries()].map(([name, s]) => ({ name, average: avg(s)!, questions: s.length })).sort((a, b) => a.average - b.average);
  const sorted = [...perQuestion].sort((a, b) => b.score - a.score);
  const recurringWeaknesses = dimensions.filter((d) => d.questions >= 2 && d.average < 60).map((d) => `${d.name} (average ${d.average}/100 across ${d.questions} answers)`);
  const incorrect = perQuestion.filter((q) => q.score < 50);
  const written = perQuestion.filter((q) => q.written);
  return {
    answered: perQuestion.length, planned, overall: avg(perQuestion.map((q) => q.score)), written: { answered: written.length, score: avg(written.map((q) => q.score)) },
    dimensions, perQuestion, strongest: sorted.slice(0, 2).filter((q) => q.score >= 50), weakest: [...sorted].reverse().slice(0, 2).filter((q) => q.score < PASS_SCORE),
    recurringWeaknesses, incorrect,
    reviseTopics: [...new Set([...recurringWeaknesses.map((w) => w.replace(/ \(.*/, "")), ...perQuestion.filter((q) => !q.passed && q.weakestDimension).map((q) => q.weakestDimension!)])].slice(0, 6),
    nextPractice: perQuestion.filter((q) => !q.passed).sort((a, b) => a.score - b.score).slice(0, 3).map((q) => `Retry: "${q.question}" (best so far ${q.score}/100)`),
  };
}
