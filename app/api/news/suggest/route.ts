import { json, withUser } from "@/lib/voice/http";
import { listArticles } from "@/lib/news/store";
import { buildMatchPrompt, matchByKeywords, parseSuggestions } from "@/lib/news/ai-match";
import { completeText } from "@/lib/ai/outreach";
import { depsFromEnv } from "@/lib/ai/service";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/** POST → up to 5 stories from the last 30 days that suit the signed-in user's profile. The AI only ranks stories we already hold. */
export const POST = (req: Request) =>
  withUser(req, "ai", async (user) => {
    const { articles } = await listArticles({ kind: "confirmed", days: 30, limit: 30, offset: 0 });
    if (!articles.length) return json({ suggestions: [], method: "none", message: "No recent stories to choose from yet." });
    const deps = depsFromEnv();
    let method: "ai" | "keywords" = "keywords";
    let picked = [] as ReturnType<typeof parseSuggestions>;
    if (deps.groqKey || deps.geminiKey) {
      try {
        const r = await completeText(buildMatchPrompt(user.profile, articles), deps);
        picked = parseSuggestions(r.text, articles);
        if (picked.length) method = "ai";
      } catch { /* fall through to keywords */ }
    }
    if (!picked.length) picked = matchByKeywords(user.profile, articles);
    const byId = new Map(articles.map((a) => [a.id, a]));
    return json({
      method,
      suggestions: picked.map((s) => ({ id: s.id, reason: s.reason, headline: byId.get(s.id)!.headline, publisher: byId.get(s.id)!.publisher, url: byId.get(s.id)!.url })),
      message: picked.length ? null : "None of the recent stories clearly match your profile.",
    });
  });
