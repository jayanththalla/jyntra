import { post } from "@/lib/interview/http";
import { assessEnglish } from "@/lib/interview/service-v2";
export const dynamic = "force-dynamic"; export const maxDuration = 60;
/** POST { session_id, speaking_seconds? } → spoken-English assessment from the session's own answers. */
export const POST = (req: Request) => post(req, "interview", (u, b) => assessEnglish(u, b.session_id, b.speaking_seconds));
