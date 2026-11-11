// Interview session persistence for v2. Every function takes the authenticated user's id and filters on it in SQL.
//  - Pause/resume: time counts only while a session is 'active'. Paused and abandoned sessions never produce a completed report.
//  - Answers are stored with their validated rubric (rubric_version 'v2'); older rows stay 'legacy'.
//  - Completing builds the report from SAVED rows only and stores it; reports for older sessions (report_version 1) are returned untouched.
import { query } from "@/lib/database";
import type { Feedback, Question } from "./index";
import { buildReportV2, type ReportV2, type SavedAnswer, type WrittenSummary } from "./report-v2";
import { progressPoint, type EnglishAssessment, type ProgressPoint } from "./english";
import type { RubricResult } from "./rubric";

export const FORMAL_PLAN: Record<10 | 20 | 30, { mainQuestions: number; written: number }> = { 10: { mainQuestions: 3, written: 3 }, 20: { mainQuestions: 5, written: 4 }, 30: { mainQuestions: 8, written: 5 } };
export const isFormalMinutes = (n: unknown): n is 10 | 20 | 30 => n === 10 || n === 20 || n === 30;

export interface SessionState { id: number; mode: "practice" | "timed"; type: string; level: string; role: string | null; status: string; stage: string; started_at: string; ended_at: string | null; target_minutes: number | null; elapsed_seconds: number; questions: Question[]; english: EnglishAssessment | null; written_result: WrittenSummary | null }
const COLS = "id, mode, type, level, role, status, stage, started_at, ended_at, target_minutes, elapsed_seconds, questions, english, written_result";

export async function createFormalSession(userId: number, s: { type: string; level: string; role?: string | null; minutes: 10 | 20 | 30; questions: Question[]; resumeProfileId?: number | null }): Promise<number> {
  const [r] = await query<{ id: number }>("INSERT INTO interview_sessions (user_id, mode, type, level, role, questions, target_minutes, resume_profile_id, report_version) VALUES ($1,'timed',$2,$3,$4,$5::jsonb,$6,$7,2) RETURNING id", [userId, s.type, s.level, s.role ?? null, JSON.stringify(s.questions), s.minutes, s.resumeProfileId ?? null]);
  return r!.id;
}

/** Resume after a refresh: the newest active-or-paused session of this user, or null. */
export async function openSession(userId: number): Promise<SessionState | null> {
  return (await query<SessionState>(`SELECT ${COLS} FROM interview_sessions WHERE user_id=$1 AND status IN ('active','paused') ORDER BY started_at DESC LIMIT 1`, [userId]))[0] ?? null;
}
export async function getState(userId: number, id: number): Promise<SessionState | null> {
  return (await query<SessionState>(`SELECT ${COLS} FROM interview_sessions WHERE id=$1 AND user_id=$2`, [id, userId]))[0] ?? null;
}

export async function pauseSession(userId: number, id: number): Promise<SessionState | null> {
  return (await query<SessionState>(`UPDATE interview_sessions SET status='paused', paused_at=now(), elapsed_seconds = elapsed_seconds + GREATEST(0, EXTRACT(EPOCH FROM (now() - active_since))::int) WHERE id=$1 AND user_id=$2 AND status='active' RETURNING ${COLS}`, [id, userId]))[0] ?? null;
}
export async function resumeSession(userId: number, id: number): Promise<SessionState | null> {
  return (await query<SessionState>(`UPDATE interview_sessions SET status='active', paused_at=NULL, active_since=now() WHERE id=$1 AND user_id=$2 AND status='paused' RETURNING ${COLS}`, [id, userId]))[0] ?? null;
}
export async function abandonSession(userId: number, id: number): Promise<boolean> {
  return (await query("UPDATE interview_sessions SET status='abandoned', ended_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('active','paused') RETURNING id", [id, userId])).length > 0;
}
/** Seconds the session has actually been running (paused time excluded). */
export const elapsedNow = (s: Pick<SessionState, "elapsed_seconds" | "status">, activeForSeconds = 0) => s.elapsed_seconds + (s.status === "active" ? Math.max(0, activeForSeconds) : 0);

export async function saveRubricAnswer(userId: number, sessionId: number, q: { id: string; text: string; written: boolean }, attempt: number, answer: string, r: RubricResult, fb: Feedback, meta: { inputMode?: "voice" | "realtime" | "text"; edited?: boolean } = {}): Promise<boolean> {
  const s = (await query<{ questions: Question[] }>("SELECT questions FROM interview_sessions WHERE id=$1 AND user_id=$2 AND status='active'", [sessionId, userId]))[0];   // paused sessions accept no answers
  if (!s || !s.questions.some((x) => x.id === q.id)) return false;
  await query("INSERT INTO interview_answers (session_id, user_id, question_id, question, written, attempt, answer, score, feedback, rubric_version, rubric_kind, rubric, input_mode, transcript_edited) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'v2',$10,$11::jsonb,$12,$13)",
    [sessionId, userId, q.id, q.text.slice(0, 500), q.written, Math.max(1, Math.min(10, attempt)), answer.slice(0, 4000), r.overall, JSON.stringify(fb), r.kind, JSON.stringify({ components: r.components, communication: r.communication }), meta.inputMode ?? null, meta.edited === true]);
  return true;
}

export async function savedAnswers(userId: number, sessionId: number): Promise<SavedAnswer[]> {
  return query<SavedAnswer>("SELECT question_id, question, written, attempt, answer, score, rubric_version, rubric_kind, rubric, feedback FROM interview_answers WHERE session_id=$1 AND user_id=$2 ORDER BY id", [sessionId, userId]);
}

export async function saveEnglish(userId: number, sessionId: number, e: EnglishAssessment): Promise<boolean> {
  return (await query("UPDATE interview_sessions SET english=$3::jsonb WHERE id=$1 AND user_id=$2 AND status IN ('active','completed') RETURNING id", [sessionId, userId, JSON.stringify(e)])).length > 0;
}
export async function saveWritten(userId: number, sessionId: number, w: WrittenSummary): Promise<boolean> {
  return (await query("UPDATE interview_sessions SET written_result=$3::jsonb, stage=CASE WHEN status='active' THEN 'done' ELSE stage END WHERE id=$1 AND user_id=$2 AND status IN ('active','completed') RETURNING id", [sessionId, userId, JSON.stringify(w)])).length > 0;
}
/** Earlier assessed sessions, oldest first, for the progress comparison. */
export async function englishHistory(userId: number, excludeId?: number): Promise<ProgressPoint[]> {
  const rows = await query<{ english: EnglishAssessment }>("SELECT english FROM interview_sessions WHERE user_id=$1 AND english IS NOT NULL AND status='completed' AND ($2::int IS NULL OR id <> $2) ORDER BY ended_at ASC LIMIT 20", [userId, excludeId ?? null]);
  return rows.map((r) => progressPoint(r.english));
}

/** Completes an ACTIVE session and stores the v2 report. Paused/abandoned/already-completed sessions return null. */
export async function completeSessionV2(userId: number, sessionId: number, activeForSeconds = 0): Promise<ReportV2 | null> {
  const s = (await query<SessionState & { elapsed: number }>(`SELECT ${COLS}, elapsed_seconds + GREATEST(0, EXTRACT(EPOCH FROM (now() - active_since))::int) AS elapsed FROM interview_sessions WHERE id=$1 AND user_id=$2 AND status='active'`, [sessionId, userId]))[0];
  if (!s) return null;
  const answers = await savedAnswers(userId, sessionId);
  const meta = { id: s.id, mode: s.mode, role: s.role, type: s.type, level: s.level, status: "completed", started_at: s.started_at, ended_at: new Date().toISOString(), elapsed_seconds: s.elapsed, planned: s.questions.length };
  const report = buildReportV2(meta, answers, { english: s.english, written: s.written_result });
  await query("UPDATE interview_sessions SET status='completed', ended_at=now(), elapsed_seconds=$3, report=$4::jsonb, report_version=2, stage='done' WHERE id=$1 AND user_id=$2", [sessionId, userId, s.elapsed, JSON.stringify(report)]);
  return report;
}

export type StoredReport = { version: 2; report: ReportV2 } | { version: 1; report: unknown };
/** Saved report of a COMPLETED session. Version-1 reports are returned exactly as they were saved. */
export async function getStoredReport(userId: number, id: number): Promise<(StoredReport & { role: string | null; startedAt: string }) | null> {
  const r = (await query<{ report: any; report_version: number; role: string | null; started_at: string }>("SELECT report, report_version, role, started_at FROM interview_sessions WHERE id=$1 AND user_id=$2 AND status='completed' AND report IS NOT NULL", [id, userId]))[0];
  if (!r) return null;
  return r.report_version >= 2 ? { version: 2, report: r.report, role: r.role, startedAt: r.started_at } : { version: 1, report: r.report, role: r.role, startedAt: r.started_at };
}

// ---- resume profiles ----
export async function saveResumeProfile(userId: number, profile: unknown, source: "upload" | "atlas" | "manual", confirmed: boolean, id?: number | null): Promise<number> {
  if (id) {
    const u = await query<{ id: number }>("UPDATE interview_resume_profiles SET profile=$3::jsonb, confirmed=$4, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id", [id, userId, JSON.stringify(profile), confirmed]);
    if (u[0]) return u[0].id;
  }
  const [r] = await query<{ id: number }>("INSERT INTO interview_resume_profiles (user_id, profile, source, confirmed) VALUES ($1,$2::jsonb,$3,$4) RETURNING id", [userId, JSON.stringify(profile), source, confirmed]);
  return r!.id;
}
export async function latestResumeProfile(userId: number) {
  return (await query<{ id: number; profile: unknown; source: string; confirmed: boolean; updated_at: string }>("SELECT id, profile, source, confirmed, updated_at FROM interview_resume_profiles WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1", [userId]))[0] ?? null;
}
export async function getResumeProfile(userId: number, id: number) {
  return (await query<{ id: number; profile: unknown; confirmed: boolean }>("SELECT id, profile, confirmed FROM interview_resume_profiles WHERE id=$1 AND user_id=$2", [id, userId]))[0] ?? null;
}
/** Text of the resume the user already gave Atlas (Career AI). Reused so nobody uploads the same file twice. */
export async function atlasResumeText(userId: number): Promise<string | null> {
  const r = (await query<{ content: string }>("SELECT content FROM kb_documents WHERE user_id=$1 AND doc_type='resume' AND status='indexed' ORDER BY synced_at DESC LIMIT 1", [userId]))[0];
  return r?.content ?? null;
}
