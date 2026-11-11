// PATCH { company?, role?, contact?, jobUrl? } edits a pending candidate; DELETE skips it.
import { guard, json, err, readJson, toId, str } from "@/lib/kb/api";
import { editCandidate, skipCandidate } from "@/lib/applications/history-store";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await ctx.params).id);
  const b = await readJson<Record<string, unknown>>(req, 20_000);
  if (!id || !b) return err("invalid_request", 400);
  const field = (k: string) => (k in b ? str(b[k], 2000) || null : undefined);
  const r = await editCandidate(g.user.id, id, { company: b.company === undefined ? undefined : str(b.company, 200), role: field("role"), contact: field("contact"), jobUrl: field("jobUrl") });
  if (r === null) return err("not_found", 404);
  if (r === "invalid") return err("invalid_company", 400);
  if (r === "clash") return err("already_in_review", 409, "Another record in review already has this company and role.");
  return json({ candidate: r });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await ctx.params).id);
  if (!id) return err("invalid_request", 400);
  return (await skipCandidate(g.user.id, id)) ? json({ ok: true }) : err("not_found", 404);
}
