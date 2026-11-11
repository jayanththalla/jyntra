// Voice interview engine. Provider-independent: the model, speech-to-text and text-to-speech are injected (VoiceDeps), so the same code
// runs against mocks in tests and Groq/Gemini + Sarvam in production. Everything is scoped by user_id and re-checked on every call.
import { query } from "@/lib/database";
import type { AppUser } from "@/lib/users";
import { AiError } from "@/lib/ai/outreach";
import { checkAudio, type AudioProblem } from "./audio";
import { capabilities, type Capabilities, type VoiceLimits } from "./config";
import { BadEvaluation, buildEvaluationPrompt, evaluationToMarkdown, parseEvaluation, type Evaluation } from "./evaluation";
import { buildTurnPrompt, cleanAnswer, DIFFICULTIES, MODES, normalizeTurn, untrusted, type Difficulty, type SessionContext, type Turn, type VoiceMode } from "./interviewer";
import { VoiceError, type SttProvider, type Transcript, type TtsProvider } from "./providers";

export class ServiceError extends Error {
  constructor(public code: string, public status: number, message: string, public retryable = false, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export interface VoiceDeps {
  llm: (prompt: string) => Promise<{ text: string; provider: string }>;
  stt: SttProvider | null;
  tts: TtsProvider | null;
  limits: VoiceLimits;
  caps: Capabilities;
  now?: () => Date;
}
const nowOf = (d: VoiceDeps) => (d.now ?? (() => new Date()))();

export interface SessionRow {
  id: number; user_id: number; mode: VoiceMode; difficulty: Difficulty; role: string; topics: string[]; seed_instruction: string; job_description: string;
  provider_config: Record<string, string>; input_mode: "voice" | "text"; status: "active" | "completed"; max_turns: number; max_minutes: number; retain_audio: boolean;
  evaluation: Evaluation | null; created_at: string; updated_at: string; ended_at: string | null;
}
export interface TurnRow { id: number; idx: number; role: "interviewer" | "candidate"; text: string; stt: Record<string, unknown> | null; created_at: string }

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

// ---------------- model access ----------------
function llmFailure(e: unknown): ServiceError {
  if (e instanceof AiError) {
    console.error(`[voice] llm ${e.code}`);
    return new ServiceError(e.code === "rate_limited" ? "llm_rate_limited" : "llm_unavailable", e.code === "rate_limited" ? 429 : 502, e.code === "rate_limited" ? "The interviewer model is rate limited. Try again in a moment." : "The interviewer model is unavailable right now.", true);
  }
  console.error("[voice] llm unexpected:", (e as Error).name);
  return new ServiceError("llm_unavailable", 502, "The interviewer model is unavailable right now.", true);
}

async function nextQuestion(ctx: SessionContext, history: Turn[], d: VoiceDeps): Promise<{ text: string; provider: string }> {
  if (!d.caps.llm.configured) throw new ServiceError("not_configured", 503, d.caps.llm.reason ?? "The interviewer model is not configured.");
  let prompt = buildTurnPrompt(ctx, history);
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: { text: string; provider: string };
    try { r = await d.llm(prompt); } catch (e) { throw llmFailure(e); }
    const n = normalizeTurn(r.text);
    if (n.ok) return { text: n.text, provider: r.provider };
    // One corrective retry (English only, single short question) before giving up. The model's rejected text is never shown or stored.
    prompt += `\n\nYour previous reply was rejected (${n.problem}). Reply again with ONE short question in English only.`;
  }
  throw new ServiceError("bad_output", 502, "The interviewer returned something we couldn't use. Try again.", true);
}

// ---------------- helpers ----------------
async function loadSession(userId: number, id: number): Promise<SessionRow> {
  const [r] = await query<any>("SELECT * FROM voice_sessions WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!r) throw new ServiceError("not_found", 404, "Session not found.");
  return { ...r, created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!, ended_at: iso(r.ended_at) };
}
async function loadTurns(userId: number, sessionId: number): Promise<TurnRow[]> {
  const rows = await query<any>("SELECT id, idx, role, text, stt, created_at FROM voice_turns WHERE session_id = $1 AND user_id = $2 ORDER BY idx", [sessionId, userId]);
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at)! }));
}
async function acquire(userId: number, id: number): Promise<void> {
  const r = await query("UPDATE voice_sessions SET busy_until = now() + interval '90 seconds' WHERE id = $1 AND user_id = $2 AND (busy_until IS NULL OR busy_until < now()) RETURNING id", [id, userId]);
  if (!r.length) throw new ServiceError("busy", 409, "The previous step is still running. Wait a moment.", true);
}
const release = (userId: number, id: number) => query("UPDATE voice_sessions SET busy_until = NULL, updated_at = now() WHERE id = $1 AND user_id = $2", [id, userId]).catch(() => {});

function contextOf(s: SessionRow, user: AppUser): SessionContext {
  const p = user.profile;
  return {
    mode: s.mode, difficulty: s.difficulty, role: s.role, topics: s.topics, seedInstruction: s.seed_instruction, jobDescription: s.job_description, maxTurns: s.max_turns,
    candidate: { skills: (p.skills ?? []).slice(0, 15), projects: (p.projects ?? []).slice(0, 4).map((x: any) => ({ name: x.name, description: x.description })) },
  };
}
const toHistory = (turns: TurnRow[]): Turn[] => turns.map((t) => ({ role: t.role, text: t.text }));
const expired = (s: SessionRow, d: VoiceDeps) => nowOf(d).getTime() - Date.parse(s.created_at) > s.max_minutes * 60_000;
const interviewerCount = (turns: TurnRow[]) => turns.filter((t) => t.role === "interviewer").length;

export interface SessionView { session: Omit<SessionRow, "user_id" | "seed_instruction" | "job_description"> & { has_seed: boolean }; turns: TurnRow[]; recordings: number; remaining: { turns: number; seconds: number } }
async function view(userId: number, id: number, d: VoiceDeps): Promise<SessionView> {
  const s = await loadSession(userId, id);
  const turns = await loadTurns(userId, id);
  const [rc] = await query<{ n: string }>("SELECT count(*) AS n FROM voice_recordings WHERE session_id = $1 AND user_id = $2 AND expires_at > now()", [id, userId]);
  const { user_id, seed_instruction, job_description, ...pub } = s;
  return { session: { ...pub, has_seed: !!seed_instruction }, turns, recordings: Number(rc.n), remaining: { turns: Math.max(0, s.max_turns - interviewerCount(turns)), seconds: Math.max(0, Math.round((s.max_minutes * 60_000 - (nowOf(d).getTime() - Date.parse(s.created_at))) / 1000)) } };
}

// ---------------- sessions ----------------
export interface CreateInput { mode: unknown; difficulty?: unknown; role?: unknown; topics?: unknown; seed_instruction?: unknown; job_description?: unknown; input_mode?: unknown; retain_audio?: unknown; consent_audio?: unknown }

export async function createSession(user: AppUser, raw: CreateInput, d: VoiceDeps): Promise<SessionView> {
  if (typeof raw.mode !== "string" || !(MODES as readonly string[]).includes(raw.mode)) throw new ServiceError("invalid_mode", 400, "Choose an interview mode.");
  const difficulty = typeof raw.difficulty === "string" && (DIFFICULTIES as readonly string[]).includes(raw.difficulty) ? (raw.difficulty as Difficulty) : "medium";
  const inputMode = raw.input_mode === "text" ? "text" : "voice";
  if (inputMode === "voice" && !d.caps.spoken) throw new ServiceError("speech_unavailable", 503, d.caps.stt.reason ?? "Speech is not configured. Use the text-only interview.");
  if (!d.caps.textOnly) throw new ServiceError("not_configured", 503, d.caps.llm.reason ?? "The interviewer model is not configured.");
  const topics = Array.isArray(raw.topics) ? raw.topics.map((t) => untrusted(String(t), 60).text).filter(Boolean).slice(0, 8) : [];
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ").trim().slice(0, n) : "");
  // Recording audio needs an explicit consent flag; asking to retain without it is refused rather than silently ignored.
  const retain = raw.retain_audio === true;
  if (retain && raw.consent_audio !== true) throw new ServiceError("consent_required", 400, "Saving recordings needs your explicit consent.");
  const [{ n }] = await query<{ n: string }>("SELECT count(*) AS n FROM voice_sessions WHERE user_id = $1 AND status = 'active'", [user.id]);
  if (Number(n) >= d.limits.maxActiveSessions) throw new ServiceError("too_many_active", 429, `You already have ${n} unfinished sessions. Finish or delete one first.`);
  const cfg = { stt: inputMode === "voice" ? d.caps.stt.provider : null, tts: inputMode === "voice" ? d.caps.tts.provider : null, llm: d.caps.llm.providers.join("+") };
  const [row] = await query<{ id: number }>(
    `INSERT INTO voice_sessions (user_id, mode, difficulty, role, topics, seed_instruction, job_description, provider_config, input_mode, max_turns, max_minutes, retain_audio)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [user.id, raw.mode, difficulty, str(raw.role, 120), topics, str(raw.seed_instruction, 600), str(raw.job_description, 4000), JSON.stringify(cfg), inputMode, d.limits.maxTurns, d.limits.maxMinutes, retain && inputMode === "voice"]
  );
  const s = await loadSession(user.id, row.id);
  try {
    await acquire(user.id, s.id);
    const q = await nextQuestion(contextOf(s, user), [], d);
    await query("INSERT INTO voice_turns (session_id, user_id, idx, role, text) VALUES ($1,$2,0,'interviewer',$3)", [s.id, user.id, q.text]);
  } catch (e) {
    await query("DELETE FROM voice_sessions WHERE id = $1 AND user_id = $2", [s.id, user.id]); // no question → no half-created session
    throw e;
  } finally {
    await release(user.id, s.id);
  }
  return view(user.id, s.id, d);
}

export async function listSessions(userId: number) {
  const rows = await query<any>(
    `SELECT s.id, s.mode, s.difficulty, s.role, s.status, s.input_mode, s.created_at, s.ended_at, (s.evaluation IS NOT NULL) AS has_evaluation,
            (SELECT count(*) FROM voice_turns t WHERE t.session_id = s.id AND t.role = 'candidate') AS answers
     FROM voice_sessions s WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 50`, [userId]);
  return rows.map((r) => ({ ...r, answers: Number(r.answers), created_at: iso(r.created_at), ended_at: iso(r.ended_at) }));
}

export const getSession = (user: AppUser, id: number, d: VoiceDeps) => view(user.id, id, d);

export async function deleteSession(userId: number, id: number): Promise<void> {
  const r = await query("DELETE FROM voice_sessions WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]); // cascades to turns and recordings
  if (!r.length) throw new ServiceError("not_found", 404, "Session not found.");
}

// ---------------- turns ----------------
export interface AnswerInput { text: unknown; edited?: unknown; stt?: Partial<Transcript> | null }

/** Records an ACCEPTED answer and returns the next interviewer question (or finished: true at the limit). */
export async function submitAnswer(user: AppUser, id: number, a: AnswerInput, d: VoiceDeps): Promise<{ view: SessionView; finished: boolean }> {
  const s = await loadSession(user.id, id);
  if (s.status !== "active") throw new ServiceError("session_ended", 409, "This session has ended.");
  if (expired(s, d)) throw new ServiceError("time_limit", 409, "The session time limit was reached. End it to see your evaluation.", false, { finished: true });
  const text = typeof a.text === "string" ? cleanAnswer(a.text, d.limits.maxAnswerChars) : "";
  if (text.length < 2) throw new ServiceError("empty_answer", 400, "The answer is empty.");
  await acquire(user.id, id);
  try {
    const turns = await loadTurns(user.id, id);
    const last = turns[turns.length - 1];
    if (!last || last.role !== "interviewer") throw new ServiceError("not_your_turn", 409, "There is no open question to answer.");
    const stt = a.stt ? { provider: a.stt.provider ?? null, language: a.stt.language ?? null, segments: Array.isArray(a.stt.segments) ? a.stt.segments.slice(0, 600) : [], confidence: a.stt.confidence ?? null, edited: a.edited === true } : { provider: null, edited: a.edited === true };
    const [cand] = await query<{ id: number }>("INSERT INTO voice_turns (session_id, user_id, idx, role, text, stt) VALUES ($1,$2,$3,'candidate',$4,$5) RETURNING id", [id, user.id, last.idx + 1, text, JSON.stringify(stt)]);
    void cand;
    const all = [...turns, { id: 0, idx: last.idx + 1, role: "candidate" as const, text, stt: null, created_at: "" }];
    if (interviewerCount(all) >= s.max_turns) return { view: await view(user.id, id, d), finished: true };
    const q = await nextQuestion(contextOf(s, user), toHistory(all), d);
    await query("INSERT INTO voice_turns (session_id, user_id, idx, role, text) VALUES ($1,$2,$3,'interviewer',$4)", [id, user.id, last.idx + 2, q.text]);
    return { view: await view(user.id, id, d), finished: false };
  } catch (e) {
    // The accepted answer stays saved even when the model fails; the client can ask for the question again.
    if (e instanceof ServiceError && e.code !== "not_your_turn" && e.code !== "busy") e.extra = { ...e.extra, answerSaved: true };
    throw e;
  } finally {
    await release(user.id, id);
  }
}

/** Retries question generation when the last turn is an answer (the model failed after the answer was saved). */
export async function retryQuestion(user: AppUser, id: number, d: VoiceDeps): Promise<SessionView> {
  const s = await loadSession(user.id, id);
  if (s.status !== "active") throw new ServiceError("session_ended", 409, "This session has ended.");
  await acquire(user.id, id);
  try {
    const turns = await loadTurns(user.id, id);
    const last = turns[turns.length - 1];
    if (!last || last.role !== "candidate") throw new ServiceError("nothing_to_retry", 409, "No question is waiting to be generated.");
    if (interviewerCount(turns) >= s.max_turns) throw new ServiceError("limit_reached", 409, "The question limit was reached. End the session.", false, { finished: true });
    const q = await nextQuestion(contextOf(s, user), toHistory(turns), d);
    await query("INSERT INTO voice_turns (session_id, user_id, idx, role, text) VALUES ($1,$2,$3,'interviewer',$4)", [id, user.id, last.idx + 1, q.text]);
  } finally {
    await release(user.id, id);
  }
  return view(user.id, id, d);
}

// ---------------- evaluation ----------------
export async function endSession(user: AppUser, id: number, d: VoiceDeps): Promise<{ evaluation: Evaluation; view: SessionView }> {
  const s = await loadSession(user.id, id);
  if (s.status === "completed" && s.evaluation) return { evaluation: s.evaluation, view: await view(user.id, id, d) };
  const turns = await loadTurns(user.id, id);
  const answers = turns.filter((t) => t.role === "candidate").map((t) => t.text);
  if (!answers.length) throw new ServiceError("no_answers", 400, "Answer at least one question before ending the session.");
  if (!d.caps.llm.configured) throw new ServiceError("not_configured", 503, d.caps.llm.reason ?? "The evaluator is not configured.");
  await acquire(user.id, id);
  try {
    // Only an interviewer turn that was answered counts; an unanswered final question is left out of the evaluation.
    const hist = toHistory(turns);
    if (hist[hist.length - 1]?.role === "interviewer") hist.pop();
    const turnCount = hist.filter((t) => t.role === "interviewer").length;
    const prompt = buildEvaluationPrompt(contextOf(s, user), hist);
    let evaluation: Evaluation | null = null;
    for (let attempt = 0; attempt < 2 && !evaluation; attempt++) {
      let r: { text: string };
      try { r = await d.llm(attempt ? prompt + "\n\nYour previous reply did not match the JSON schema. Return only the JSON object." : prompt); } catch (e) { throw llmFailure(e); }
      try { evaluation = parseEvaluation(r.text, answers, turnCount, nowOf(d)); } catch (e) { if (!(e instanceof BadEvaluation)) throw e; }
    }
    if (!evaluation) throw new ServiceError("bad_output", 502, "The evaluator returned something we couldn't use. Try again.", true);
    await query("UPDATE voice_sessions SET evaluation = $3, status = 'completed', ended_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2", [id, user.id, JSON.stringify(evaluation)]);
    return { evaluation, view: await view(user.id, id, d) };
  } finally {
    await release(user.id, id);
  }
}

export async function exportSession(user: AppUser, id: number, format: "json" | "md", d: VoiceDeps): Promise<{ body: string; mime: string; filename: string }> {
  const v = await view(user.id, id, d);
  const title = `${v.session.mode.replace(/_/g, " ")} practice, ${v.session.created_at.slice(0, 10)}`;
  if (format === "json") return { body: JSON.stringify({ session: { id: v.session.id, mode: v.session.mode, difficulty: v.session.difficulty, role: v.session.role, topics: v.session.topics, created_at: v.session.created_at, ended_at: v.session.ended_at }, turns: v.turns.map((t) => ({ idx: t.idx, role: t.role, text: t.text })), evaluation: v.session.evaluation }, null, 2), mime: "application/json", filename: `voice-session-${id}.json` };
  const tr = v.turns.map((t) => `**${t.role === "interviewer" ? "Interviewer" : "You"}:** ${t.text}`).join("\n\n");
  const ev = v.session.evaluation ? "\n\n---\n\n" + evaluationToMarkdown(v.session.evaluation, "Evaluation") : "";
  return { body: `# ${title}\n\n_Practice simulation, not a real interview._\n\n${tr}${ev}\n`, mime: "text/markdown", filename: `voice-session-${id}.md` };
}

// ---------------- speech ----------------
/** Transcribes ONE recording. Nothing is stored: the text goes back to the browser for review and only an accepted answer is saved. */
export async function transcribe(user: AppUser, sessionId: number, audio: Uint8Array, mime: string, claimedSeconds: number | null, d: VoiceDeps): Promise<Transcript> {
  const s = await loadSession(user.id, sessionId); // ownership check; also stops use of the endpoint without a session
  if (s.status !== "active") throw new ServiceError("session_ended", 409, "This session has ended.");
  if (!d.stt || !d.caps.stt.configured) throw new ServiceError("stt_unavailable", 503, d.caps.stt.reason ?? "Speech-to-text is not configured. Type your answer instead.");
  const chk = checkAudio(audio, mime, { maxBytes: d.limits.maxAudioBytes, maxSeconds: d.limits.maxAudioSeconds, claimedSeconds });
  if (!chk.ok) throw new ServiceError("invalid_audio", chk.problem === "too_large" ? 413 : 400, audioMessage(chk.problem!), false, { problem: chk.problem });
  try {
    return await d.stt.transcribe({ audio, mime: chk.mime! });
  } catch (e) {
    throw speechFailure(e);
  }
}

export async function speak(user: AppUser, sessionId: number, idx: number, d: VoiceDeps): Promise<{ audio: Uint8Array; mime: string }> {
  await loadSession(user.id, sessionId);
  // Only a stored interviewer turn of the caller's own session can be spoken: the endpoint is not a general text-to-speech proxy.
  const [t] = await query<{ text: string; role: string }>("SELECT text, role FROM voice_turns WHERE session_id = $1 AND user_id = $2 AND idx = $3", [sessionId, user.id, idx]);
  if (!t || t.role !== "interviewer") throw new ServiceError("not_found", 404, "Turn not found.");
  if (!d.tts || !d.caps.tts.configured || d.caps.tts.provider !== "sarvam") throw new ServiceError("tts_unavailable", 503, d.caps.tts.reason ?? "Server speech is not configured.", false, { fallback: "text" });
  try {
    const r = await d.tts.synthesize({ text: t.text });
    return { audio: r.audio, mime: r.mime };
  } catch (e) {
    const se = speechFailure(e);
    se.extra = { ...se.extra, fallback: "text" }; // the UI keeps showing the text, and may offer the browser voice
    throw se;
  }
}

function audioMessage(p: AudioProblem): string {
  return { empty: "No audio was received.", too_large: "That recording is too large. Record a shorter answer.", unsupported_type: "That audio format is not supported.", type_mismatch: "The file does not look like the audio type it claims to be.", too_long: "That recording is too long. Keep answers short or split them.", too_short: "That recording is too short. Record again." }[p];
}
function speechFailure(e: unknown): ServiceError {
  if (e instanceof ServiceError) return e;
  if (e instanceof VoiceError) {
    const map: Record<string, [number, string]> = { rate_limited: [429, "The speech service is busy. Try again in a moment."], quota_exhausted: [503, "The speech provider's free quota is used up. Type your answer instead, or try later."], auth: [503, "Speech is misconfigured on the server."], invalid_audio: [400, "That audio could not be read. Record again."], timeout: [504, "The speech service took too long. Try again."], unavailable: [502, "The speech service is unavailable right now."], empty: [422, e.message], bad_response: [502, "The speech service returned something unexpected."], not_configured: [503, e.message] };
    const [status, msg] = map[e.code] ?? [502, "Speech failed."];
    return new ServiceError(e.code === "empty" ? "no_speech" : `speech_${e.code}`, status, msg, e.retryable || e.code === "empty" || e.code === "invalid_audio", e.retryAfterSeconds ? { retryAfterSeconds: e.retryAfterSeconds } : {});
  }
  return new ServiceError("speech_unavailable", 502, "The speech service is unavailable right now.", true);
}

// ---------------- recordings (only with consent, expiring) ----------------
export async function purgeExpiredRecordings(): Promise<number> {
  return (await query("DELETE FROM voice_recordings WHERE expires_at < now() RETURNING id")).length;
}

export async function saveRecording(user: AppUser, sessionId: number, turnIdx: number, audio: Uint8Array, mime: string, d: VoiceDeps): Promise<{ id: number; expires_at: string }> {
  const s = await loadSession(user.id, sessionId);
  if (!s.retain_audio) throw new ServiceError("consent_required", 403, "This session was not started with permission to keep recordings.");
  const chk = checkAudio(audio, mime, { maxBytes: d.limits.maxAudioBytes, maxSeconds: d.limits.maxAudioSeconds });
  if (!chk.ok) throw new ServiceError("invalid_audio", chk.problem === "too_large" ? 413 : 400, audioMessage(chk.problem!), false, { problem: chk.problem });
  const [t] = await query<{ id: number }>("SELECT id FROM voice_turns WHERE session_id = $1 AND user_id = $2 AND idx = $3 AND role = 'candidate'", [sessionId, user.id, turnIdx]);
  if (!t) throw new ServiceError("not_found", 404, "Only an accepted answer can have a recording.");
  const [tot] = await query<{ b: string }>("SELECT COALESCE(sum(size_bytes),0) AS b FROM voice_recordings WHERE session_id = $1 AND user_id = $2", [sessionId, user.id]);
  const cap = d.limits.maxAudioBytes * s.max_turns;
  if (Number(tot.b) + audio.length > cap) throw new ServiceError("storage_limit", 413, "This session's recording storage limit was reached.");
  const expires = new Date(nowOf(d).getTime() + d.limits.audioRetentionDays * 86_400_000);
  const [r] = await query<{ id: number }>("INSERT INTO voice_recordings (session_id, turn_id, user_id, mime, size_bytes, audio, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [sessionId, t.id, user.id, chk.mime, audio.length, Buffer.from(audio), expires]);
  return { id: r.id, expires_at: expires.toISOString() };
}

export async function deleteRecordings(userId: number, sessionId: number): Promise<number> {
  await loadSession(userId, sessionId);
  return (await query("DELETE FROM voice_recordings WHERE session_id = $1 AND user_id = $2 RETURNING id", [sessionId, userId])).length;
}

export { capabilities };
