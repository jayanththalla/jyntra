import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { INTERVIEW_LEVELS, INTERVIEW_TYPES, type Question } from "@/lib/interview";
import { completeSession, createSession, deleteSession, getSession, listSessions } from "@/lib/interview/sessions";

export const dynamic = "force-dynamic";
const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 2_147_483_647;

/** GET /api/interview/sessions            -> history of the signed-in user's sessions
 *  GET /api/interview/sessions?id=N       -> one session with transcripts, evaluations and report (404 for anyone else's) */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read"); if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "no_profile" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (id !== null) {
    const n = Number(id);
    if (!isId(n)) return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
    const s = await getSession(user.id, n);
    return s ? NextResponse.json({ ok: true, session: s }) : NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, sessions: await listSessions(user.id) });
}

/** POST { action:"create", mode, type, level, role?, startup_id?, questions } | { action:"complete", session_id } */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "interview"); if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "no_profile" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 32_768) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  if (b.action === "create") {
    if ((b.mode !== "practice" && b.mode !== "timed") || !(INTERVIEW_TYPES as readonly string[]).includes(String(b.type)) || !(INTERVIEW_LEVELS as readonly string[]).includes(String(b.level)) || !Array.isArray(b.questions) || b.questions.length < 1 || b.questions.length > 12) return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
    const questions: Question[] = (b.questions as any[]).map((q, i) => ({ id: typeof q?.id === "string" ? q.id.slice(0, 20) : `q${i + 1}`, text: String(q?.text ?? "").slice(0, 500), focus: String(q?.focus ?? "").slice(0, 160), ...(q?.written === true ? { written: true } : {}) })).filter((q) => q.text.length >= 10);
    if (!questions.length) return NextResponse.json({ ok: false, error: "invalid_questions" }, { status: 400 });
    const id = await createSession(user.id, { mode: b.mode, type: String(b.type), level: String(b.level), role: typeof b.role === "string" ? b.role.slice(0, 120) : null, startupId: isId(b.startup_id) ? b.startup_id : null, questions });
    return NextResponse.json({ ok: true, session_id: id });
  }
  if (b.action === "complete") {
    if (!isId(b.session_id)) return NextResponse.json({ ok: false, error: "invalid_session" }, { status: 400 });
    const report = await completeSession(user.id, b.session_id);
    return report ? NextResponse.json({ ok: true, report }) : NextResponse.json({ ok: false, error: "not_found_or_finished" }, { status: 404 });
  }
  return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const limited = rateLimit(req, "interview"); if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "no_profile" }, { status: 401 });
  const n = Number(req.nextUrl.searchParams.get("id"));
  if (!isId(n)) return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  return (await deleteSession(user.id, n)) ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
}
