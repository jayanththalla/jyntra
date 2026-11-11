// Interview session persistence. Every function takes the authenticated user's id and filters on it: one user can never read or
// write another user's sessions, transcripts or reports.
import { query } from "@/lib/database";
import { buildReport, type InterviewReport, type StoredAnswer } from "./report";
import type { Feedback, Question } from "./index";

export interface SessionRow { id: number; mode: "practice" | "timed"; type: string; level: string; role: string | null; status: string; started_at: string; ended_at: string | null; questions: Question[]; report: InterviewReport | null }

export async function createSession(userId: number, s: { mode: "practice" | "timed"; type: string; level: string; role?: string | null; startupId?: number | null; questions: Question[] }): Promise<number> {
  const [r] = await query<{ id: number }>("INSERT INTO interview_sessions (user_id, mode, type, level, role, startup_id, questions) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id", [userId, s.mode, s.type, s.level, s.role ?? null, s.startupId ?? null, JSON.stringify(s.questions)]);
  return r!.id;
}

export async function activeSession(userId: number, id: number): Promise<SessionRow | null> {
  return (await query<SessionRow>("SELECT id, mode, type, level, role, status, started_at, ended_at, questions, report FROM interview_sessions WHERE id=$1 AND user_id=$2 AND status='active'", [id, userId]))[0] ?? null;
}

/** Stores one evaluated attempt. The question must belong to the session's own plan, so a client cannot write arbitrary rows. */
export async function saveAnswer(userId: number, sessionId: number, q: { id: string; text: string; written: boolean }, attempt: number, answer: string, fb: Feedback): Promise<boolean> {
  const s = await activeSession(userId, sessionId);
  if (!s || !s.questions.some((x) => x.id === q.id)) return false;
  await query("INSERT INTO interview_answers (session_id, user_id, question_id, question, written, attempt, answer, score, feedback) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)", [sessionId, userId, q.id, q.text.slice(0, 500), q.written, Math.max(1, Math.min(10, attempt)), answer.slice(0, 4000), fb.score, JSON.stringify(fb)]);
  return true;
}

export async function answersFor(userId: number, sessionId: number): Promise<StoredAnswer[]> {
  return query<StoredAnswer>("SELECT question_id, question, written, attempt, answer, score, feedback FROM interview_answers WHERE session_id=$1 AND user_id=$2 ORDER BY id", [sessionId, userId]);
}

export async function completeSession(userId: number, sessionId: number, status: "completed" | "abandoned" = "completed"): Promise<InterviewReport | null> {
  const s = await activeSession(userId, sessionId);
  if (!s) return null;
  const report = buildReport(await answersFor(userId, sessionId), s.questions.length);
  await query("UPDATE interview_sessions SET status=$3, ended_at=now(), report=$4::jsonb WHERE id=$1 AND user_id=$2", [sessionId, userId, status, JSON.stringify(report)]);
  return report;
}

export async function listSessions(userId: number, limit = 30) {
  return query<{ id: number; mode: string; type: string; level: string; role: string | null; status: string; started_at: string; ended_at: string | null; overall: number | null; answered: number }>(
    "SELECT id, mode, type, level, role, status, started_at, ended_at, (report->>'overall')::int AS overall, COALESCE((report->>'answered')::int, 0) AS answered FROM interview_sessions WHERE user_id=$1 ORDER BY started_at DESC LIMIT $2", [userId, Math.min(limit, 100)]);
}

export async function getSession(userId: number, id: number) {
  const s = (await query<SessionRow>("SELECT id, mode, type, level, role, status, started_at, ended_at, questions, report FROM interview_sessions WHERE id=$1 AND user_id=$2", [id, userId]))[0];
  if (!s) return null;
  return { ...s, answers: await answersFor(userId, id) };
}

export async function deleteSession(userId: number, id: number): Promise<boolean> {
  return (await query<{ id: number }>("DELETE FROM interview_sessions WHERE id=$1 AND user_id=$2 RETURNING id", [id, userId])).length > 0;
}
