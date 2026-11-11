// DELETE { confirm: "delete" }: removes the candidate's entire knowledge base.
import { guard, json, err, readJson } from "@/lib/kb/api";
import { deleteAllKnowledge } from "@/lib/kb/store";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const b = await readJson<{ confirm?: string }>(req, 1000);
  if (b?.confirm !== "delete") return err("confirmation_required", 400, 'Send {"confirm":"delete"} to delete everything.');
  await deleteAllKnowledge(g.user.id);
  return json({ ok: true });
}
