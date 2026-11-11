import { guard, json, err, readJson, toId } from "@/lib/kb/api";
import { deleteAnswer, editAnswer } from "@/lib/career/store";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const limit = (v: unknown) => (v === null ? null : typeof v === "number" && Number.isInteger(v) && v >= 10 && v <= 20_000 ? v : undefined);

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const b = await readJson<Record<string, any>>(req, 60_000);
  if (!id || !b) return err("invalid_request", 400);
  const p: Parameters<typeof editAnswer>[2] = {};
  if (typeof b.answer === "string") p.answer = b.answer;
  if (typeof b.question === "string" && b.question.trim()) p.question = b.question.trim();
  if ("word_limit" in b) { const v = limit(b.word_limit); if (v === undefined) return err("invalid_limit", 400); p.word_limit = v; }
  if ("char_limit" in b) { const v = limit(b.char_limit); if (v === undefined) return err("invalid_limit", 400); p.char_limit = v; }
  const a = await editAnswer(g.user.id, id, p);
  return a ? json({ answer: a }) : err("not_found", 404);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  return id && (await deleteAnswer(g.user.id, id)) ? json({ ok: true }) : err("not_found", 404);
}
