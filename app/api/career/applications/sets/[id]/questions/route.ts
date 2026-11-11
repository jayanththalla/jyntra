import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { addQuestion } from "@/lib/career/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const b = await readJson<Record<string, any>>(req, 10_000);
  const q = str(b?.question, 2000);
  if (!id || !q) return err("invalid_request", 400, "Type the question first.");
  const a = await addQuestion(g.user.id, id, q);
  return a ? json({ answer: a }, 201) : err("not_found", 404, "Set not found, or it already has 30 questions.");
}
