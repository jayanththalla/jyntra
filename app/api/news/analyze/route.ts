import { json, withUser } from "@/lib/voice/http";
import { analyzeArticle } from "@/lib/news/analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * POST { id, refresh? } → AI analysis of one stored story. The model sees only the facts we hold for that story; the reply is
 * validated against them. Without an AI key the answer is status "not_configured": the page still shows the facts.
 */
export const POST = (req: Request) =>
  withUser(req, "ai", async () => {
    const body = (await req.json().catch(() => null)) as { id?: unknown; refresh?: unknown } | null;
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) return json({ error: "invalid_id" }, 400);
    const r = await analyzeArticle(id, undefined, body?.refresh === true);
    if (!r) return json({ error: "not_found", message: "That story is no longer stored." }, 404);
    return json(r);
  });
