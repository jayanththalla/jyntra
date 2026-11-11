import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { deleteFact, updateFact } from "@/lib/career/store";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const b = await readJson<Record<string, any>>(req, 8_000);
  if (!id || !b) return err("invalid_request", 400);
  const f = await updateFact(g.user.id, id, { text: str(b.text, 1000) || undefined, category: str(b.category, 30) || undefined, confirm: b.confirm === true });
  return f ? json({ fact: f }) : err("not_found", 404);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  return id && (await deleteFact(g.user.id, id)) ? json({ ok: true }) : err("not_found", 404);
}
