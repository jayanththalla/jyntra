// POST { decisions: [{ id, action: "create" | "merge", mergeInto?, createAnyway? }] } -> creates applications from reviewed candidates.
import { guard, json, err, readJson, toId } from "@/lib/kb/api";
import { confirm, type ConfirmDecision } from "@/lib/applications/history-store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const b = await readJson<{ decisions?: unknown }>(req, 50_000);
  if (!b || !Array.isArray(b.decisions) || !b.decisions.length) return err("invalid_request", 400);
  const decisions: ConfirmDecision[] = [];
  for (const d of b.decisions.slice(0, 200) as any[]) {
    const id = toId(d?.id);
    if (!id || (d.action !== "create" && d.action !== "merge")) return err("invalid_request", 400);
    decisions.push({ id, action: d.action, mergeInto: toId(d.mergeInto) ?? undefined, createAnyway: d.createAnyway === true });
  }
  return json({ results: await confirm(g.user.id, decisions) });
}
