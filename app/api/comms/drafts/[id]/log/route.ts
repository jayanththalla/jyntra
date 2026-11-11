// POST { confirm: true } -> records that the USER sent this message themselves. Jyntra sends nothing here.
import { guard, json, err, readJson, toId } from "@/lib/kb/api";
import { logManualSend } from "@/lib/comms/send";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const b = await readJson<Record<string, unknown>>(req, 1_000);
  if (!id || !b) return err("invalid_request", 400);
  try {
    const r = await logManualSend(g.user, id, { confirm: b.confirm });
    return json(r.body, r.status);
  } catch (e) {
    console.error("[api/comms/log]", (e as Error).name);
    return err("server_error", 500);
  }
}
