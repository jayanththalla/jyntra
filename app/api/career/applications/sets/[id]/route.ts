import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { deleteSet, getSet, updateSet } from "@/lib/career/store";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const s = id ? await getSet(g.user.id, id) : null;
  return s ? json({ set: s }) : err("not_found", 404);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const b = await readJson<Record<string, any>>(req, 60_000);
  if (!id || !b) return err("invalid_request", 400);
  const p: Parameters<typeof updateSet>[2] = {};
  if (typeof b.title === "string") p.title = str(b.title, 100);
  if (typeof b.jd_text === "string") p.jd_text = str(b.jd_text, 12_000);
  if ("application_id" in b) p.application_id = b.application_id === null ? null : toId(b.application_id);
  if ("resume_document_id" in b) p.resume_document_id = b.resume_document_id === null ? null : toId(b.resume_document_id);
  const r = await updateSet(g.user.id, id, p);
  if (!("ok" in r)) return err(r.error, r.error === "not_found" ? 404 : 400);
  return json({ set: await getSet(g.user.id, id) });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  return id && (await deleteSet(g.user.id, id)) ? json({ ok: true }) : err("not_found", 404);
}
