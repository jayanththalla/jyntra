import { readJson } from "@/lib/kb/api";
import { fail, json, sessionId, withUser } from "@/lib/voice/http";
import { voiceDeps } from "@/lib/voice/runtime";
import { retryQuestion, ServiceError, submitAnswer } from "@/lib/voice/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { text, edited?, stt? } → records the ACCEPTED answer and returns the next question.
 * POST { retry: true } → generates the next question again after a model failure (the answer was already saved).
 * This is the only way text reaches the interviewer, so a draft transcript that was never accepted cannot.
 */
export const POST = (req: Request, c: { params: Promise<{ id: string }> }) =>
  withUser(req, "voiceTurn", async (user) => {
    const id = sessionId(await c.params);
    const b = await readJson<Record<string, unknown>>(req, 60_000);
    if (!b) return fail(new ServiceError("invalid_request", 400, "Invalid request."));
    if (b.retry === true) return json({ view: await retryQuestion(user, id, voiceDeps()), finished: false });
    return json(await submitAnswer(user, id, { text: b.text, edited: b.edited, stt: (b.stt as never) ?? null }, voiceDeps()));
  });
