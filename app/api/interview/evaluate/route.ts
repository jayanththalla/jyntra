import { post } from "@/lib/interview/http";
import { evaluateAnswer } from "@/lib/interview/service-v2";
export const dynamic = "force-dynamic"; export const maxDuration = 60;
/** POST { session_id, question_id, answer, attempt?, input_mode?, edited? } → weighted 0-100 rubric result (or a retryable error and NO score). */
export const POST = (req: Request) => post(req, "interview", (u, b) => evaluateAnswer(u, b));
