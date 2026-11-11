import { guard, json, err, toId } from "@/lib/kb/api";
import { query } from "@/lib/database";
import { deleteDocuments } from "@/lib/kb/store";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const [d] = id ? await query("SELECT id, source_id, provider, doc_type, title, url, project, metadata, status, error, source_modified_at, synced_at, left(content, 20000) AS content FROM kb_documents WHERE id = $1 AND user_id = $2", [id, g.user.id]) : [];
  return d ? json({ document: d }) : err("not_found", 404);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const [d] = id ? await query("SELECT id FROM kb_documents WHERE id = $1 AND user_id = $2", [id, g.user.id]) : [];
  if (!d) return err("not_found", 404);
  await deleteDocuments(g.user.id, [d.id]);
  return json({ ok: true });
}
