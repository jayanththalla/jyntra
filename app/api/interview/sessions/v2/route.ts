import { guard, json } from "@/lib/interview/http";
import { post } from "@/lib/interview/http";
import { FORMAL_PLAN, abandonSession, completeSessionV2, createFormalSession, isFormalMinutes, openSession, pauseSession, resumeSession, getState, elapsedNow } from "@/lib/interview/sessions-v2";
import { INTERVIEW_LEVELS, INTERVIEW_TYPES, type Question } from "@/lib/interview";
export const dynamic = "force-dynamic";

/** GET → the user's open (active or paused) session, if any: this is what survives a page refresh. */
export async function GET(req: Request) {
  const g = await guard(req, "read"); if ("res" in g) return g.res;
  const s = await openSession(g.user.id);
  return json({ ok: true, session: s ? { ...s, elapsed_seconds: elapsedNow(s) } : null, plan: FORMAL_PLAN });
}
/** POST { action: "create_formal"|"pause"|"resume"|"complete"|"abandon", ... } */
export const POST = (req: Request) => post(req, "write", async (u, b) => {
  const id = typeof b.session_id === "number" ? b.session_id : 0;
  if (b.action === "create_formal") {
    if (!isFormalMinutes(b.minutes)) return { status: 400, body: { ok: false, error: "invalid_minutes", message: "Choose 10, 20 or 30 minutes." } };
    if (typeof b.type !== "string" || !(INTERVIEW_TYPES as readonly string[]).includes(b.type) || typeof b.level !== "string" || !(INTERVIEW_LEVELS as readonly string[]).includes(b.level)) return { status: 400, body: { ok: false, error: "invalid_request" } };
    if (await openSession(u.id)) return { status: 409, body: { ok: false, error: "session_open", message: "You already have an interview in progress. Resume or end it first." } };
    const qs = (Array.isArray(b.questions) ? b.questions : []).slice(0, FORMAL_PLAN[b.minutes].mainQuestions) as Question[];
    if (qs.length < 1 || qs.some((q) => !q || typeof q.id !== "string" || typeof q.text !== "string")) return { status: 400, body: { ok: false, error: "invalid_questions" } };
    const sid = await createFormalSession(u.id, { type: b.type, level: b.level, role: typeof b.role === "string" ? b.role.slice(0, 120) : null, minutes: b.minutes, questions: qs.map((q) => ({ id: q.id.slice(0, 40), text: q.text.slice(0, 500), focus: String(q.focus ?? "").slice(0, 200), written: q.written === true })), resumeProfileId: typeof b.resume_profile_id === "number" ? b.resume_profile_id : null });
    return { status: 200, body: { ok: true, session_id: sid, plan: FORMAL_PLAN[b.minutes] } };
  }
  if (!id) return { status: 400, body: { ok: false, error: "invalid_request" } };
  if (b.action === "pause") { const s = await pauseSession(u.id, id); return s ? { status: 200, body: { ok: true, session: s } } : { status: 409, body: { ok: false, error: "not_active" } }; }
  if (b.action === "resume") { const s = await resumeSession(u.id, id); return s ? { status: 200, body: { ok: true, session: s } } : { status: 409, body: { ok: false, error: "not_paused" } }; }
  if (b.action === "abandon") return (await abandonSession(u.id, id)) ? { status: 200, body: { ok: true } } : { status: 409, body: { ok: false, error: "not_open" } };
  if (b.action === "complete") {
    const s = await getState(u.id, id); if (!s) return { status: 404, body: { ok: false, error: "not_found" } };
    if (s.status === "paused") return { status: 409, body: { ok: false, error: "paused", message: "Resume the interview before finishing it. Paused sessions are not reported." } };
    const r = await completeSessionV2(u.id, id); return r ? { status: 200, body: { ok: true, report: r } } : { status: 409, body: { ok: false, error: "not_active" } };
  }
  return { status: 400, body: { ok: false, error: "invalid_action" } };
});
