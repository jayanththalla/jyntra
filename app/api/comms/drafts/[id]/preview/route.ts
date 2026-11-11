// POST -> the final message exactly as it would be sent, plus the hash to echo when confirming. Sends and records nothing.
import { guard, json, err, toId } from "@/lib/kb/api";
import { previewDraft } from "@/lib/comms/send";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  if (!id) return err("invalid_request", 400);
  const r = await previewDraft(g.user, id);
  return json(r.body, r.status);
}
