import { post } from "@/lib/interview/http";
import { writtenStart, writtenSubmit, writtenFinish } from "@/lib/interview/service-v2";
export const dynamic = "force-dynamic"; export const maxDuration = 60;
/** POST { action: "start"|"submit"|"finish", ... }. Correct answers leave the server only in the result of a submission. */
export const POST = (req: Request) => post(req, "interviewWritten", (u, b) => b.action === "start" ? writtenStart(u, b) : b.action === "submit" ? writtenSubmit(u, b) : b.action === "finish" ? writtenFinish(u, b.session_id) : { status: 400, body: { ok: false, error: "invalid_action" } }, 20_000);
