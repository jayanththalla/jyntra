import { guard, json } from "@/lib/kb/api";
import { listConversations } from "@/lib/kb/conversations";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const sp = new URL(req.url).searchParams;
  return json({ conversations: await listConversations(g.user.id, Number(sp.get("limit") ?? 30) || 30, Math.max(0, Number(sp.get("offset") ?? 0) || 0), sp.get("q") ?? "") });
}
