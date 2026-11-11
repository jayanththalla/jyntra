// Codeforces connector: the documented public API only (https://codeforces.com/api). No login, no scraping.
// Wording keeps OBSERVED activity apart from anything inferred: we only count what the API reports.
import { kbFetch } from "../http";
import { SourceError, type Connector, type RawDoc, type SyncContext, type SyncResult } from "../types";

const API = "https://codeforces.com/api";
const HANDLE = /^[A-Za-z0-9_.-]{3,24}$/;

interface CfEnvelope<T> { status: "OK" | "FAILED"; comment?: string; result?: T }

let sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
/** Tests replace the inter-request pause (the API asks for roughly one request per two seconds). */
export const setCodeforcesSleep = (fn: (ms: number) => Promise<void>) => { sleepFn = fn; };

async function call<T>(ctx: SyncContext, path: string, first: boolean): Promise<T> {
  if (!first) await sleepFn(2000);
  // Codeforces reports API errors as HTTP 400 with a JSON {status:"FAILED", comment}, so the body is read for any status.
  let res: Response;
  try {
    res = await ctx.fetchImpl(`${API}/${path}`, { headers: { "User-Agent": "Jyntra-KB" }, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new SourceError("unavailable", "Codeforces could not be reached.");
  }
  if (res.status === 429) throw new SourceError("rate_limited", "Codeforces rate limit reached.", 2000);
  if (res.status >= 500) throw new SourceError("unavailable", "Codeforces is unavailable.");
  const env = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
  if (!env) throw new SourceError("unavailable", "Codeforces returned an unreadable response.");
  if (env.status !== "OK") {
    if (/not found|does not exist/i.test(env.comment ?? "")) throw new SourceError("not_found", "That Codeforces handle was not found.");
    if (/limit exceeded/i.test(env.comment ?? "")) throw new SourceError("rate_limited", "Codeforces rate limit reached.", 2000);
    throw new SourceError("unavailable", "Codeforces returned an error.");
  }
  return env.result as T;
}

interface Sub { id: number; creationTimeSeconds: number; verdict?: string; programmingLanguage: string; problem: { contestId?: number; index: string; name: string; rating?: number; tags: string[] } }

const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

export const codeforcesConnector: Connector = {
  provider: "codeforces",
  async probe(ctx) {
    const handle = String(ctx.config.handle ?? "").trim();
    if (!HANDLE.test(handle)) return { latestChangeAt: null };
    const res = await kbFetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=1`, { fetchImpl: ctx.fetchImpl, retries: 0, timeoutMs: 6_000 });
    const j = (await res.json().catch(() => null)) as { status?: string; result?: { creationTimeSeconds?: number }[] } | null;
    const t = j?.status === "OK" ? j.result?.[0]?.creationTimeSeconds : null;
    return { latestChangeAt: t ? new Date(t * 1000).toISOString() : null };
  },
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const handle = String(ctx.config.handle ?? "").trim();
    if (!HANDLE.test(handle)) throw new SourceError("invalid", "Enter a valid Codeforces handle.");
    const h = encodeURIComponent(handle);
    const warnings: string[] = [];
    const info = (await call<any[]>(ctx, `user.info?handles=${h}`, true))[0];
    if (!info) throw new SourceError("not_found", "That Codeforces handle was not found.");
    let rating: { contestName: string; rank: number; oldRating: number; newRating: number; ratingUpdateTimeSeconds: number }[] = [];
    try {
      rating = await call(ctx, `user.rating?handle=${h}`, false);
    } catch (e) {
      if (e instanceof SourceError && e.code === "not_found") throw e;
      warnings.push("Contest history could not be read.");
    }
    let subs: Sub[] = [];
    let complete = true;
    try {
      subs = await call<Sub[]>(ctx, `user.status?handle=${h}&from=1&count=2000`, false);
    } catch (e) {
      if (e instanceof SourceError && e.code === "not_found") throw e;
      warnings.push("Submission history could not be read; only the profile and ratings were indexed.");
      complete = false;
    }

    const verdicts = new Map<string, number>(), tags = new Map<string, number>(), langs = new Map<string, number>(), buckets = new Map<string, number>();
    const solved = new Map<string, Sub>();
    for (const s of subs) {
      inc(verdicts, s.verdict ?? "UNKNOWN");
      inc(langs, s.programmingLanguage);
      if (s.verdict === "OK") {
        const k = `${s.problem.contestId ?? "gym"}${s.problem.index}`;
        if (!solved.has(k)) solved.set(k, s);
      }
    }
    for (const s of solved.values()) {
      for (const t of s.problem.tags) inc(tags, t);
      const r = s.problem.rating;
      inc(buckets, r == null ? "unrated" : r < 1200 ? "<1200" : r < 1600 ? "1200-1599" : r < 2000 ? "1600-1999" : "2000+");
    }
    const recent = [...solved.entries()].sort((a, b) => b[1].creationTimeSeconds - a[1].creationTimeSeconds).slice(0, 25);
    const date = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
    const url = `https://codeforces.com/profile/${encodeURIComponent(handle)}`;
    const docs: RawDoc[] = [];
    const mod = subs[0] ? new Date(Math.max(...subs.map((s) => s.creationTimeSeconds)) * 1000).toISOString() : null;

    docs.push({
      externalId: `codeforces:${handle}:profile`, docType: "coding_stats", title: `Codeforces profile: ${handle}`, url, modifiedAt: mod,
      content: [`Codeforces handle: ${handle}`, `Observed: current rating ${info.rating ?? "unrated"}, rank ${info.rank ?? "unrated"}; maximum rating ${info.maxRating ?? "n/a"} (${info.maxRank ?? "n/a"}).`,
        `Observed: ${rating.length} rated contest(s) participated in.`,
        rating.length ? `Recent contests:\n${rating.slice(-10).reverse().map((c) => `- ${date(c.ratingUpdateTimeSeconds)} ${c.contestName}: rank ${c.rank}, rating ${c.oldRating} → ${c.newRating} (${c.newRating - c.oldRating >= 0 ? "+" : ""}${c.newRating - c.oldRating})`).join("\n")}` : ""].filter(Boolean).join("\n"),
      metadata: { handle, rating: info.rating ?? null, maxRating: info.maxRating ?? null, technologies: [] },
    });
    if (complete)
      docs.push({
        externalId: `codeforces:${handle}:submissions`, docType: "coding_stats", title: `Codeforces submissions summary: ${handle}`, url, modifiedAt: mod,
        content: [
          `Observed from the public API (latest ${subs.length} submissions): solved ${solved.size} distinct problems with a verdict of OK. Attempted submissions are not counted as solved.`,
          `Submissions by verdict: ${top(verdicts, 8).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`,
          `Observed solved problems by difficulty bucket: ${[...buckets.entries()].map(([k, v]) => `${k}: ${v}`).join(", ") || "none"}.`,
          `Observed solved problems by tag (most frequent first): ${top(tags, 15).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`,
          `Languages used in submissions: ${top(langs, 6).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`,
          "Note: counts describe observed activity. They are not a measure of proficiency.",
        ].join("\n"),
        metadata: { solved: solved.size, topTags: top(tags, 10).map(([k]) => k), technologies: [] },
      });
    if (recent.length)
      docs.push({
        externalId: `codeforces:${handle}:recent-solved`, docType: "coding_stats", title: `Codeforces recently solved problems: ${handle}`, url, modifiedAt: mod,
        content: `Observed: most recently solved problems (verdict OK):\n${recent.map(([k, s]) => `- ${date(s.creationTimeSeconds)} ${s.problem.name} (${k}${s.problem.rating ? `, rating ${s.problem.rating}` : ""}; tags: ${s.problem.tags.join(", ") || "none"}; language: ${s.programmingLanguage})`).join("\n")}`,
        metadata: { technologies: [] },
      });
    ctx.log(`codeforces: ${docs.length} documents`);
    return { docs, complete, warnings };
  },
};
