// Facts the candidate keeps about themselves (notice period, salary expectation, a short achievement ...).
// "user_confirmed" facts are used as verified. Facts saved from a model answer are "ai_suggested" and unused until confirmed.
import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { addFact, listFacts } from "@/lib/career/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  return json({ facts: await listFacts(g.user.id) });
}

export async function POST(req: Request) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const b = await readJson<Record<string, any>>(req, 8_000);
  const text = str(b?.text, 1000);
  if (!b || !text) return err("invalid_request", 400, "Write the fact first.");
  // The browser says where the text came from; only an explicit "from_answer" is stored as a suggestion.
  const f = await addFact(g.user.id, { category: str(b.category, 30), text, origin: b.from_answer === true ? "ai_suggested" : "user_confirmed", conversationId: toId(b.conversation_id) });
  return json({ fact: f }, 201);
}
