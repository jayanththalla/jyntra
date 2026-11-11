// Orchestration for application answers: load the answer + its set (owner-scoped), run the pipeline, store the result.
import { answerOne, type AnswerDeps, type AnswerOutput } from "./answers";
import { TONES, type Adjust } from "./application";
import { defaultAnswerDeps, getAnswer, limitsOf, loadApplicationJob, saveGenerated } from "./store";
import { query } from "@/lib/database";
import type { AppUser } from "@/lib/users";

export function parseAdjust(b: Record<string, unknown>): Adjust | null {
  const k = typeof b.adjust === "string" ? b.adjust : "generate";
  if (k === "generate" || k === "shorten" || k === "expand") return { kind: k };
  if (k === "tone" && typeof b.tone === "string" && (TONES as readonly string[]).includes(b.tone)) return { kind: "tone", tone: b.tone as (typeof TONES)[number] };
  return null;
}

export async function generateForAnswer(user: AppUser, answerId: number, adjust: Adjust, deps: AnswerDeps = defaultAnswerDeps()): Promise<{ answer: any; result: AnswerOutput } | null> {
  const a = await getAnswer(user.id, answerId);
  if (!a) return null;
  const [set] = await query<any>("SELECT id, application_id, jd_text, resume_document_id, source_ids FROM app_answer_sets WHERE id = $1 AND user_id = $2", [a.set_id, user.id]);
  if (!set) return null;
  const job = set.application_id ? await loadApplicationJob(user.id, set.application_id) : null;
  // Shorten / expand / tone need an existing answer to work from; with none they are a normal generation.
  const adj: Adjust = adjust.kind !== "generate" && !a.answer?.trim() ? { kind: "generate" } : adjust;
  const result = await answerOne(
    user,
    { question: a.question, limits: limitsOf(a), sourceIds: set.source_ids?.length ? set.source_ids : undefined, resumeDocumentId: set.resume_document_id, job, jd: set.jd_text || undefined, adjust: adj, previousAnswer: adj.kind === "generate" ? undefined : a.answer },
    deps
  );
  // A needs_input result with no text must not wipe an answer the candidate already has.
  if (result.status === "needs_input" && !result.answer && a.answer?.trim()) return { answer: { ...a, missing: result.missing, status: "needs_input" }, result };
  return { answer: await saveGenerated(user.id, answerId, result), result };
}
