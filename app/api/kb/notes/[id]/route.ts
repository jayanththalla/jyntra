import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { query } from "@/lib/database";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const b = await readJson<Record<string, any>>(req, 80_000);
  if (!id || !b) return err("invalid_request", 400);
  const [n] = await query("UPDATE kb_notes SET title = COALESCE(NULLIF($3, ''), title), content = COALESCE(NULLIF($4, ''), content), updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id, title, content, updated_at", [id, g.user.id, str(b.title, 160), str(b.content, 40_000)]);
  return n ? json({ note: n }) : err("not_found", 404);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const r = id ? await query("DELETE FROM kb_notes WHERE id = $1 AND user_id = $2 RETURNING id", [id, g.user.id]) : [];
  return r.length ? json({ ok: true }) : err("not_found", 404);
}
