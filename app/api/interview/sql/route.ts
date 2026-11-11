import { post } from "@/lib/interview/http";
import { sqlList, sqlProblem, sqlRun, sqlGrade } from "@/lib/interview/service-v2";
export const dynamic = "force-dynamic"; export const maxDuration = 30;
/** POST { action: "list"|"problem"|"run"|"grade", problem_id?, sql? }. SQL runs in an isolated in-memory SQLite sandbox, never on the application database. */
export const POST = (req: Request) => post(req, "interviewWritten", (u, b) => b.action === "list" ? sqlList() : b.action === "problem" ? sqlProblem(b.problem_id) : b.action === "run" ? sqlRun(b) : b.action === "grade" ? sqlGrade(u, b) : { status: 400, body: { ok: false, error: "invalid_action" } }, 20_000);
