import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { deleteConversation, getConversation, renameConversation } from "@/lib/kb/conversations";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const c = id ? await getConversation(g.user.id, id) : null;
  return c ? json({ conversation: c }) : err("not_found", 404);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  return id && (await deleteConversation(g.user.id, id, { alsoFacts: new URL(req.url).searchParams.get("delete_facts") === "1" })) ? json({ ok: true }) : err("not_found", 404);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const b = await readJson<Record<string, any>>(req, 2_000);
  const title = str(b?.title, 120);
  if (!id || !title) return err("invalid_request", 400, "Give the conversation a name.");
  return (await renameConversation(g.user.id, id, title)) ? json({ ok: true, title }) : err("not_found", 404);
}
