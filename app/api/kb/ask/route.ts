// POST { question, mode?, source_ids?, conversation_id?, job_id?, startup_id?, save? } -> grounded answer with citations.
import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { answerQuestion, defaultDeps, KbError, MODES, type Mode } from "@/lib/kb/answer";
import { saveExchange } from "@/lib/kb/conversations";
import { isFollowUp, loadHistory, rollSummary, seedFromDocuments } from "@/lib/kb/memory";
import { confirmedFacts } from "@/lib/career/store";
import { suggestActions } from "@/lib/career/actions";
import { query } from "@/lib/database";
import { TtlCache, norm } from "@/lib/kb/cache";
import type { AnswerResult } from "@/lib/kb/answer";
import { annotateCitations, defaultEnsureDeps, ensureFresh, type SourceFreshness } from "@/lib/kb/freshness";

// Identical question + same knowledge base + no conversation context => reuse the answer for 15 minutes instead of calling the AI again.
// The stamp changes whenever documents are synced or facts change, so a cached answer never outlives the data it was built from.
const answerCache = new TtlCache<AnswerResult>(15 * 60_000, 150);

export const dynamic = "force-dynamic";
export const maxDuration = 80;

export async function POST(req: Request) {
  const g = await guard(req, "kbAsk");
  if ("res" in g) return g.res;
  const b = await readJson<Record<string, any>>(req, 60_000);
  if (!b) return err("invalid_request", 400);
  const mode = (str(b.mode, 30) || "auto") as Mode;
  if (!(MODES as readonly string[]).includes(mode)) return err("invalid_mode", 400);
  const question = str(b.question, 12_000);
  const jobId = toId(b.job_id);
  const startupId = toId(b.startup_id);
  if (!question && !(mode === "job_match" && jobId) && !(mode === "startup_fit" && startupId)) return err("empty_question", 400, "Type or paste a question first.");
  const userId = g.user.id;
  // Only sources that belong to this user can scope a search.
  let sourceIds: number[] | undefined;
  if (Array.isArray(b.source_ids) && b.source_ids.length) {
    const wanted = b.source_ids.map(toId).filter((x: number | null): x is number => !!x).slice(0, 20);
    sourceIds = (await query<{ id: number }>("SELECT id FROM kb_sources WHERE user_id = $1 AND id = ANY($2::int[])", [userId, wanted])).map((r) => r.id);
    if (!sourceIds.length) return err("no_sources", 403, "None of the selected sources are available.");
  }
  // "other projects" follow-ups: exclude projects the previous answers in this conversation already cited (owner-scoped).
  let excludeProjects: string[] | undefined;
  const convId = toId(b.conversation_id);
  if (convId) {
    excludeProjects = (await query<{ project: string }>(
      `SELECT DISTINCT d.project FROM kb_messages m JOIN kb_documents d ON d.id = ANY(m.document_ids) AND d.user_id = m.user_id
       WHERE m.conversation_id = $1 AND m.user_id = $2 AND m.role = 'assistant' AND d.project IS NOT NULL`, [convId, userId]
    ).catch(() => [])).map((r) => r.project);
  }
  // Memory: a rolling summary plus the last few messages (never the whole chat). Facts the candidate confirmed ride along.
  const hist = convId ? await loadHistory(userId, convId).catch(() => null) : null;
  const seedHits = hist && isFollowUp(question) ? await seedFromDocuments(userId, hist.lastCitedDocs).catch(() => []) : [];
  const userFacts = await confirmedFacts(userId).catch(() => []);
  const cacheable = !convId && !seedHits.length && !hist && b.fresh !== true && !jobId && !startupId && !sourceIds;
  let key = "";
  if (cacheable) {
    const [st] = await query<{ d: string; f: string }>("SELECT (SELECT count(*) || ':' || COALESCE(max(synced_at)::text, '') FROM kb_documents WHERE user_id = $1) AS d, (SELECT count(*) || ':' || COALESCE(max(updated_at)::text, '') FROM kb_facts WHERE user_id = $1) AS f", [userId]).catch(() => [undefined as any]);
    if (st) key = `${userId}|${mode}|${norm(question)}|${st.d}|${st.f}`;
  }
  // Index freshness: queue refreshes for sources that are behind (never blocks the answer for more than a moment), then answer from the
  // latest SUCCESSFUL index and say so. A slow or failing probe changes nothing.
  // ATLAS_AUTO_REFRESH=false switches the automatic stale-index check off entirely (answers then use the index exactly as it is).
  const fresh: SourceFreshness[] = process.env.ATLAS_AUTO_REFRESH === "false" ? [] : await Promise.race([
    ensureFresh(userId, defaultEnsureDeps, sourceIds),
    new Promise<SourceFreshness[]>((r) => setTimeout(() => r([]), 2_500)),
  ]).catch(() => []);
  try {
    const cached = key ? answerCache.get(key) : undefined;
    const r = cached ?? await answerQuestion(g.user, { question, mode, sourceIds, jobId, startupId, excludeProjects, history: hist ? { summary: hist.summary, recent: hist.recent } : undefined, userFacts, seedHits }, defaultDeps());
    if (key && !cached && r.grounded && !r.insufficient) answerCache.set(key, r);
    let saved: { conversationId: number; messageId: number } | null = null;
    if (b.save !== false) saved = await saveExchange(userId, { conversationId: toId(b.conversation_id), mode, question: question || r.questionType, answer: r.answer, citations: r.citations, meta: { type: r.questionType, grounded: r.grounded, insufficient: r.insufficient, provider: r.provider, notices: r.notices } });
    if (saved) void rollSummary(userId, saved.conversationId).catch(() => {});
    // Suggestions come from what the candidate typed only. They are links, never actions that run on their own.
    const actions = suggestActions(question);
    // The understand-first step can add suggestions the keywords missed (e.g. a pasted listing that says "apply by email").
    if (r.intent?.wantsEmail && !actions.some((a) => a.type === "email_draft" || a.type === "send_email")) actions.push({ type: "email_draft", label: "Open in the email composer", href: "/career-ai/email?kind=cold_email" });
    if (r.intent?.wantsApplicationAnswers && !actions.some((a) => a.type === "application_answers")) actions.push({ type: "application_answers", label: "Answer these in Application mode", href: "/applications?view=answers" });
    // Per-source last-sync times on every citation, and one notice per source that is behind, failed or refreshing (only sources this answer used).
    const docIds = r.citations.map((c) => c.documentId).filter((x): x is number => x != null);
    const docSource = new Map<number, number>(
      docIds.length ? (await query<{ id: number; source_id: number }>("SELECT id, source_id FROM kb_documents WHERE user_id = $1 AND id = ANY($2::int[])", [userId, docIds]).catch(() => [])).map((d) => [d.id, d.source_id] as [number, number]) : []
    );
    const citations = annotateCitations(r.citations, docSource, fresh);
    const usedSources = new Set(docSource.values());
    const freshNotices = fresh.filter((f) => f.notice && (usedSources.has(f.sourceId) || !usedSources.size)).map((f) => f.notice!);
    return json({ ...r, citations, notices: [...r.notices, ...freshNotices], sources: fresh.map(({ sourceId, label, provider, state, lastSyncedAt }) => ({ sourceId, label, provider, state, lastSyncedAt })), ...saved, actions: actions.slice(0, 3) });
  } catch (e) {
    if (e instanceof KbError) return err(e.code, e.code === "not_configured" ? 503 : e.status, e.message);
    console.error("[api/kb/ask]", (e as Error).name, (e as Error).message.slice(0, 120));
    return err("server_error", 500, "Couldn't answer right now. Please try again.");
  }
}
