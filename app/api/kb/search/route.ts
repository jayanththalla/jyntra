import { guard, json, err, str, toId } from "@/lib/kb/api";
import { searchChunks } from "@/lib/kb/search";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const sp = new URL(req.url).searchParams;
  const q = str(sp.get("q"), 300);
  if (q.length < 2) return err("invalid_query", 400);
  const sourceIds = sp.getAll("source").map(toId).filter((x): x is number => !!x).slice(0, 20);
  const hits = await searchChunks(g.user.id, q, { sourceIds, limit: 15 });
  return json({ hits: hits.map((h) => ({ documentId: h.documentId, title: h.title, url: h.url, provider: h.provider, docType: h.docType, project: h.project, locator: h.locator, snippet: h.content.slice(0, 300), score: Number(h.score.toFixed(3)) })) });
}
