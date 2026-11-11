// Server-side orchestration for the mock interview. The browser sends the interview type, level and (optionally) a
// startup id; the candidate's facts and the company text are loaded here from the database, never taken from the request.
import { loadStartups } from "@/lib/discovery/read";
import type { AppUser } from "@/lib/users";
import { AiError, clean, completeText, configuredProviders, type AiDeps } from "@/lib/ai/outreach";
import { depsFromEnv } from "@/lib/ai/service";
import { saveAnswer } from "./sessions";
import {
  INTERVIEW_LEVELS,
  INTERVIEW_TYPES,
  MIN_ANSWER_CHARS,
  buildFeedbackPrompt,
  buildQuestionsPrompt,
  TOPICS,
  type Topic,
  buildRolesPrompt,
  parseRoles,
  parseFeedback,
  obviousNonAnswer,
  irrelevantFeedback,
  parseQuestions,
  type InterviewContext,
  type InterviewLevel,
  type InterviewType,
} from "./index";

export interface ServiceResult {
  status: number;
  body: Record<string, unknown>;
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 2_147_483_647;
const bad = (error: string): ServiceResult => ({ status: 400, body: { ok: false, error } });

function aiFailure(e: unknown): ServiceResult {
  if (e instanceof AiError) {
    console.error(`[api/interview] ${e.code}${e.detail ? ` (${e.detail})` : ""}`); // never the key, never the upstream body
    const status = e.code === "rate_limited" ? 429 : e.code === "timeout" ? 504 : e.code === "auth" || e.code === "model_unavailable" ? 503 : 502;
    return { status, body: { ok: false, code: e.code, message: e.message, retryable: e.retryable } };
  }
  console.error("[api/interview] unexpected:", (e as Error).name, (e as Error).message);
  return { status: 502, body: { ok: false, code: "bad_output", message: "The AI returned something we couldn't use. Try again.", retryable: true } };
}

export async function interviewForUser(user: AppUser, raw: unknown, deps: AiDeps = depsFromEnv()): Promise<ServiceResult> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("invalid_request");
  const b = raw as Record<string, unknown>;
  if (typeof b.type !== "string" || !(INTERVIEW_TYPES as readonly string[]).includes(b.type)) return bad("invalid_type");
  if (typeof b.level !== "string" || !(INTERVIEW_LEVELS as readonly string[]).includes(b.level)) return bad("invalid_level");
  if (b.action !== "start" && b.action !== "feedback" && b.action !== "roles") return bad("invalid_action");
  if (b.startup_id !== undefined && b.startup_id !== null && !isId(b.startup_id)) return bad("invalid_startup_id");

  if (configuredProviders(deps).length === 0) {
    return { status: 200, body: { ok: false, code: "not_configured", message: "The AI interviewer isn't set up on this server (no GROQ_API_KEY or GEMINI_API_KEY)." } };
  }

  const p = user.profile;
  const ctx: InterviewContext = {
    type: b.type as InterviewType,
    level: b.level as InterviewLevel,
    candidate: {
      skills: p.skills ?? [],
      years: p.tech_experience_years || 0,
      projects: (p.projects ?? []).slice(0, 3).map((x) => ({ name: x.name, description: x.description })),
    },
  };
  if (typeof b.role === "string" && b.role.trim()) ctx.role = clean(b.role, 120);
  if (typeof b.topic === "string" && (TOPICS as readonly string[]).includes(b.topic)) ctx.topic = b.topic as Topic;
  if (typeof b.job_description === "string" && b.job_description.trim().length >= 40) ctx.jobDescription = b.job_description.slice(0, 3000);
  if (isId(b.startup_id)) {
    const [s] = await loadStartups(user, { id: b.startup_id });
    if (!s) return { status: 404, body: { ok: false, error: "startup_not_found" } };
    ctx.startup = { name: s.name, description: s.description };
    ctx.role = ctx.role ?? (s.jobs.find((j) => j.match.relevance === "strong" || j.match.relevance === "potential") ?? s.jobs[0])?.job_title ?? null;
  }

  try {
    if (b.action === "roles") {
      if (!ctx.candidate.skills.length && !ctx.candidate.projects.length) return { status: 200, body: { ok: false, code: "no_profile_data", message: "Add skills or projects to your profile first, so suggestions come from your real experience." } };
      const r = await completeText(buildRolesPrompt(ctx), deps);
      return { status: 200, body: { ok: true, roles: parseRoles(r.text), provider: r.provider } };
    }
    if (b.action === "start") {
      const count = typeof b.count === "number" ? Math.max(3, Math.min(8, Math.round(b.count))) : 5;
      const r = await completeText(buildQuestionsPrompt(ctx, count, { timed: b.timed === true }), deps);
      return { status: 200, body: { ok: true, questions: parseQuestions(r.text, count), startup: ctx.startup?.name ?? null, role: ctx.role ?? null, provider: r.provider } };
    }
    const question = typeof b.question === "string" ? clean(b.question, 500) : "";
    const answer = typeof b.answer === "string" ? clean(b.answer, 4000) : "";
    if (question.length < 10) return bad("invalid_question");
    if (answer.length < MIN_ANSWER_CHARS) return bad("answer_too_short");
    const persist = async (fb: ReturnType<typeof parseFeedback>) => {
      // Stored only for the caller's own active session, with the score the SERVER computed.
      if (!isId(b.session_id) || typeof b.question_id !== "string") return;
      await saveAnswer(user.id, b.session_id, { id: b.question_id, text: question, written: b.written === true }, typeof b.attempt === "number" ? Math.round(b.attempt) : 1, answer, fb);
    };
    const gate = obviousNonAnswer(answer);
    if (gate) { const fb = irrelevantFeedback(gate); await persist(fb); return { status: 200, body: { ok: true, feedback: fb, provider: "local" } }; } // no model call needed
    const r = await completeText(buildFeedbackPrompt(ctx, question, answer), deps);
    const fb = parseFeedback(r.text);
    await persist(fb);
    return { status: 200, body: { ok: true, feedback: fb, provider: r.provider } };
  } catch (e) {
    return aiFailure(e);
  }
}
