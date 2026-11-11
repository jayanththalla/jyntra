import { guard, json } from "@/lib/interview/http";
import { extractText } from "@/lib/kb/extract";
import { sniffResume, ResumeFileError, extractResumeProfile, recommendRoles, sanitizeProfile, MAX_RESUME_BYTES } from "@/lib/resume/profile";
import { atlasResumeText, getResumeProfile, latestResumeProfile, saveResumeProfile } from "@/lib/interview/sessions-v2";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const maxDuration = 30;

/** GET → the user's saved (reviewed) interview profile, or one built from the resume they already gave Atlas. Nothing is uploaded twice. */
export async function GET(req: Request) {
  const g = await guard(req, "read"); if ("res" in g) return g.res;
  const saved = await latestResumeProfile(g.user.id);
  if (saved) { const p = sanitizeProfile(saved.profile); return json({ ok: true, source: saved.source, confirmed: saved.confirmed, id: saved.id, profile: p, roles: recommendRoles(p) }); }
  const text = await atlasResumeText(g.user.id);
  if (!text) return json({ ok: true, source: null, profile: null, roles: [] });
  const p = extractResumeProfile(text);
  return json({ ok: true, source: "atlas", confirmed: false, id: null, profile: p, roles: recommendRoles(p) });
}

/** POST multipart { file } → parsed profile for REVIEW. The file is read in memory and discarded; nothing is stored until PUT. */
export async function POST(req: Request) {
  const g = await guard(req, "interviewResume"); if ("res" in g) return g.res;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_RESUME_BYTES + 200_000) return json({ ok: false, error: "too_large", message: "Resumes can be at most 5 MB." }, 413);
  let form: FormData; try { form = await req.formData(); } catch { return json({ ok: false, error: "invalid_request", message: "Upload a PDF or DOCX file." }, 400); }
  const file = form.get("file"); if (!(file instanceof File)) return json({ ok: false, error: "no_file", message: "No file was uploaded." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const kind = sniffResume(bytes);                                      // decided by content, not by name or MIME
    const r = await extractText({ name: `resume.${kind}`, bytes: Buffer.from(bytes) });
    if ("error" in r) return json({ ok: false, error: r.error, message: r.message }, r.error === "too_large" ? 413 : 422);
    const profile = extractResumeProfile(r.text);
    return json({ ok: true, kind, profile, roles: recommendRoles(profile) });
  } catch (e) {
    if (e instanceof ResumeFileError) return json({ ok: false, error: e.code, message: e.message }, e.code === "too_large" ? 413 : 415);
    return json({ ok: false, error: "unreadable", message: "We couldn't read this file. It may be corrupted or password-protected." }, 422);
  }
}

/** PUT { profile, id?, source? } → saves the profile the user reviewed and corrected. */
export async function PUT(req: Request) {
  const g = await guard(req, "write"); if ("res" in g) return g.res;
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, error: "invalid_request" }, 400); }
  const p = sanitizeProfile(b?.profile);
  if (!p.skills.length && !p.projects.length && !p.experience.length && !p.internships.length) return json({ ok: false, error: "empty_profile", message: "Add at least a skill or a project." }, 400);
  if (typeof b?.id === "number" && !(await getResumeProfile(g.user.id, b.id))) return json({ ok: false, error: "not_found" }, 404);
  const id = await saveResumeProfile(g.user.id, p, b?.source === "atlas" || b?.source === "manual" ? b.source : "upload", true, typeof b?.id === "number" ? b.id : null);
  return json({ ok: true, id, profile: p, roles: recommendRoles(p) });
}
