// POST { confirm: true, content_hash, acknowledge_unknown? } -> sends ONE previewed draft. Never called by chat, models or retrieved text.
import { guard, json, err, readJson, toId } from "@/lib/kb/api";
import { sendDraft } from "@/lib/comms/send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, "emailSend");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const b = await readJson<Record<string, unknown>>(req, 2_000);
  if (!id || !b) return err("invalid_request", 400);
  try {
    const r = await sendDraft(g.user, id, { confirm: b.confirm, contentHash: b.content_hash, acknowledgeUnknown: b.acknowledge_unknown });
    return json(r.body, r.status);
  } catch (e) {
    console.error("[api/comms/send]", (e as Error).name);
    return err("server_error", 500, "Something went wrong. Check your Sent folder before trying again.");
  }
}
