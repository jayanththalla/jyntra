import { guard, json, err, readJson, toId } from "@/lib/kb/api";
import { deleteDraft, getDraft, publicDraft, updateDraft } from "@/lib/comms/store";
import { validateDraft } from "@/lib/comms/validate";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const d = id ? await getDraft(g.user.id, id) : null;
  return d ? json({ draft: publicDraft(d) }) : err("not_found", 404);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const cur = id ? await getDraft(g.user.id, id) : null;
  if (!id || !cur) return err("not_found", 404);
  if (cur.status === "sent" || cur.status === "sending") return err("locked", 409, cur.status === "sent" ? "This message was already sent." : "This message is being sent.");
  const b = await readJson<Record<string, unknown>>(req, 40_000);
  const v = b ? validateDraft(b, "save", cur as unknown as Partial<import("@/lib/comms/validate").DraftInput>) : null;
  if (!v || !v.ok) return err(v && !v.ok ? v.error : "invalid_request", 400);
  const d = await updateDraft(g.user.id, id, v.value);
  return d ? json({ draft: publicDraft(d) }) : err("locked", 409);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  return id && (await deleteDraft(g.user.id, id)) ? json({ ok: true }) : err("not_found", 404, "Only unsent drafts can be deleted.");
}
