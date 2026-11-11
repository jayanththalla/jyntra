// GET: indexed documents (paginated). POST (multipart): upload a resume/notes/report; text is extracted, redacted, chunked, indexed.
import { guard, json, err, str } from "@/lib/kb/api";
import { query } from "@/lib/database";
import { extractText, MAX_UPLOAD_BYTES } from "@/lib/kb/extract";
import { createSource, rebuildEntities, storeDocuments } from "@/lib/kb/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const size = Math.min(50, Math.max(1, Number(sp.get("limit") ?? 20) || 20));
  const params: unknown[] = [g.user.id];
  let where = "user_id = $1";
  const sid = Number(sp.get("source"));
  if (Number.isInteger(sid) && sid > 0) (params.push(sid), (where += ` AND source_id = $${params.length}`));
  const type = str(sp.get("type"), 20);
  if (type) (params.push(type), (where += ` AND doc_type = $${params.length}`));
  const [rows, [{ n }]] = await Promise.all([
    query(`SELECT id, source_id, provider, doc_type, title, url, project, status, source_modified_at, synced_at, length(content) AS chars FROM kb_documents WHERE ${where} ORDER BY synced_at DESC, id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params),
    query<{ n: number }>(`SELECT count(*)::int AS n FROM kb_documents WHERE ${where}`, params),
  ]);
  return json({ documents: rows, total: n, page, pageSize: size });
}

export async function POST(req: Request) {
  const g = await guard(req, "kbUpload");
  if ("res" in g) return g.res;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 100_000) return err("too_large", 413, "Files can be up to 5 MB.");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err("invalid_request", 400);
  }
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string").slice(0, 5);
  if (!files.length) return err("no_file", 400, "Choose a file to upload.");
  const userId = g.user.id;
  let [src] = await query<{ id: number }>("SELECT id FROM kb_sources WHERE user_id = $1 AND provider = 'upload' AND status <> 'disconnected' ORDER BY id LIMIT 1", [userId]);
  if (!src) src = await createSource(userId, { provider: "upload", label: "Uploaded documents", status: "connected" });
  const results: { name: string; ok: boolean; message?: string; warnings?: string[] }[] = [];
  for (const f of files) {
    const bytes = Buffer.from(await f.arrayBuffer());
    const ex = await extractText({ name: f.name, mime: f.type, bytes });
    if ("error" in ex) {
      results.push({ name: f.name, ok: false, message: ex.message });
      continue;
    }
    const stats = await storeDocuments(userId, src.id, "upload", [{ externalId: `file:${f.name.slice(0, 150)}`, docType: ex.docType, title: f.name.slice(0, 200), content: ex.text, modifiedAt: new Date(f.lastModified || Date.now()).toISOString() }], { complete: false });
    results.push({ name: f.name, ok: stats.failed === 0, message: stats.duplicates ? "Already indexed from another source." : stats.unchanged ? "Unchanged." : undefined, warnings: ex.warnings });
  }
  await rebuildEntities(userId);
  await query("UPDATE kb_sources SET last_synced_at = now(), status = 'connected', last_error = NULL WHERE id = $1 AND user_id = $2", [src.id, userId]);
  return json({ results }, results.some((r) => r.ok) ? 201 : 422);
}
