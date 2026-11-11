// POST { adjust?: "generate"|"shorten"|"expand"|"tone", tone? } -> (re)generates ONE answer from the candidate's evidence.
import { guard, json, err, readJson, toId } from "@/lib/kb/api";
import { KbError } from "@/lib/kb/answer";
import { generateForAnswer, parseAdjust } from "@/lib/career/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, "kbAsk");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const b = (await readJson<Record<string, any>>(req, 2_000)) ?? {};
  const adjust = parseAdjust(b);
  if (!id || !adjust) return err("invalid_request", 400);
  try {
    const r = await generateForAnswer(g.user, id, adjust);
    return r ? json({ answer: r.answer, provider: r.result.provider, words: r.result.words, chars: r.result.chars }) : err("not_found", 404);
  } catch (e) {
    if (e instanceof KbError) return err(e.code, e.code === "not_configured" ? 503 : e.status, e.message);
    console.error("[api/career/generate]", (e as Error).name, (e as Error).message.slice(0, 120));
    return err("server_error", 500, "Couldn't generate this answer right now. Please try again.");
  }
}
