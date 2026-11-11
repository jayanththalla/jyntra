// GET  -> the user's saved application sets (paginated)
// POST { raw, title?, jd_text?, application_id?, resume_document_id?, source_ids? } -> parses the pasted form into questions and saves the set
import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { query } from "@/lib/database";
import { createSet, listSets } from "@/lib/career/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const sp = new URL(req.url).searchParams;
  return json({ sets: await listSets(g.user.id, Number(sp.get("limit") ?? 20) || 20, Number(sp.get("offset") ?? 0) || 0) });
}

export async function POST(req: Request) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const b = await readJson<Record<string, any>>(req, 120_000);
  if (!b) return err("invalid_request", 400);
  const raw = str(b.raw, 40_000);
  if (!raw) return err("empty_input", 400, "Paste one or more application questions first.");
  const userId = g.user.id;
  const applicationId = toId(b.application_id);
  if (applicationId && !(await query("SELECT 1 FROM applications WHERE id = $1 AND user_id = $2", [applicationId, userId])).length) return err("not_found", 404, "That application isn't yours or no longer exists.");
  const resumeId = toId(b.resume_document_id);
  if (resumeId && !(await query("SELECT 1 FROM kb_documents WHERE id = $1 AND user_id = $2 AND doc_type = 'resume'", [resumeId, userId])).length) return err("not_found", 404, "That resume isn't available.");
  let sourceIds: number[] = [];
  if (Array.isArray(b.source_ids) && b.source_ids.length) {
    const wanted = b.source_ids.map(toId).filter((x: number | null): x is number => !!x).slice(0, 20);
    sourceIds = (await query<{ id: number }>("SELECT id FROM kb_sources WHERE user_id = $1 AND id = ANY($2::int[])", [userId, wanted])).map((r) => r.id);
  }
  const r = await createSet(userId, { raw, title: str(b.title, 100), jd: str(b.jd_text, 12_000), applicationId, resumeDocumentId: resumeId, sourceIds });
  if ("error" in r) return err("no_questions", 400, "I couldn't find any questions in that text. Paste each question on its own line, or number them.");
  return json({ set: r.set }, 201);
}
