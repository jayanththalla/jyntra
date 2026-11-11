// POST -> drafts a message and SAVES it as a draft. This route cannot send: sending is a separate, confirmed step.
import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { KbError } from "@/lib/kb/answer";
import { query } from "@/lib/database";
import { defaultAnswerDeps, loadApplicationJob } from "@/lib/career/store";
import { generateEmail, LENGTHS, TONES, type GenerateInput, type Length, type Tone } from "@/lib/comms/generate";
import { createDraft, publicDraft } from "@/lib/comms/store";
import { EMAIL_KINDS, parseRecipients, type EmailKind } from "@/lib/comms/validate";
import { isValidEmail } from "@/lib/outreach/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const g = await guard(req, "ai");
  if ("res" in g) return g.res;
  const b = await readJson<Record<string, any>>(req, 60_000);
  if (!b) return err("invalid_request", 400);
  const kind = str(b.kind, 30) as EmailKind;
  if (!(EMAIL_KINDS as readonly string[]).includes(kind)) return err("invalid_kind", 400);
  const tone = (str(b.tone, 20) || "professional") as Tone;
  const length = (str(b.length, 10) || "medium") as Length;
  if (!(TONES as readonly string[]).includes(tone) || !(length in LENGTHS)) return err("invalid_request", 400);
  const userId = g.user.id;

  // Context comes from the database for ids the user supplies; the client never sends company facts.
  let company = str(b.company, 120), role = str(b.role, 120), context = "";
  let applicationId = toId(b.application_id), startupId = toId(b.startup_id), jobId = toId(b.job_id);
  if (applicationId) {
    const [a] = await query<any>("SELECT startup_id, job_id FROM applications WHERE id = $1 AND user_id = $2", [applicationId, userId]);
    if (!a) return err("not_found", 404, "Application not found.");
    const j = await loadApplicationJob(userId, applicationId);
    startupId = a.startup_id; jobId = a.job_id;
    if (j) { company = company || j.company; role = role || j.title; context = j.text; }
  }
  // If the candidate pasted a listing with exactly one email address ("Apply: chris@x.com"), pre-fill the recipient with it. It is their own text, shown in the composer for review.
  const found = [...new Set((str(b.notes, 2000).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((x) => x.toLowerCase()))];
  const to = str(b.to_email, 254) || (found.length === 1 ? found[0] : "");
  if (to && !isValidEmail(to)) return err("invalid_to_email", 400);
  const cc = parseRecipients(b.cc);
  if (!cc.ok) return err(cc.error, 400);
  const input: GenerateInput = { kind, tone, length, recipientName: str(b.recipient_name, 80), company, role, context, thread: str(b.thread, 6000), notes: str(b.notes, 2000) };
  try {
    const r = await generateEmail(g.user, input, defaultAnswerDeps());
    if (r.missing.length && !r.body) return json({ missing: r.missing, draft: null });
    const toFinal = to || r.recipientEmail || "";
    const draft = await createDraft(userId, { kind, to_email: toFinal && isValidEmail(toFinal) ? toFinal.toLowerCase() : null, recipient_name: input.recipientName || null, cc: cc.list, subject: r.subject, body: r.body, application_id: applicationId, startup_id: startupId, job_id: jobId }, { context: { tone, length, company, role }, citations: r.citations });
    return json({ draft: publicDraft(draft), warnings: r.warnings, missing: r.missing, citations: r.citations, provider: r.provider }, 201);
  } catch (e) {
    if (e instanceof KbError) return err(e.code, e.code === "not_configured" ? 503 : e.status, e.message);
    console.error("[api/comms/generate]", (e as Error).name, (e as Error).message.slice(0, 120));
    return err("server_error", 500, "Couldn't write the draft right now. Please try again.");
  }
}
