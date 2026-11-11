// Conversation memory. The model gets a short rolling summary of old turns plus the last few messages, never the whole chat.
// The summary is built WITHOUT a model call (no extra cost, nothing a model can embellish) and is context only:
// the knowledge base stays the source of truth for facts about the candidate.
import { query } from "@/lib/database";
import type { Hit } from "./search";

export const RECENT_MESSAGES = 6;
const ROLL_AFTER = 10; // unsummarised messages beyond the recent window before the summary is rolled forward
const SUMMARY_MAX = 1500;

export interface Turn { role: "user" | "assistant"; content: string }

/** Folds older turns into the summary: what the candidate asked, in order, shortest form. Oldest lines drop first. */
export function summarizeTurns(prev: string, turns: Turn[]): string {
  const lines = prev ? prev.split("\n").filter(Boolean) : [];
  for (const t of turns) {
    if (t.role !== "user") continue;
    const q = t.content.replace(/\s+/g, " ").trim();
    if (q) lines.push(`- asked: ${q.length > 110 ? q.slice(0, 107) + "..." : q}`);
  }
  let out = lines.join("\n");
  while (out.length > SUMMARY_MAX && lines.length > 1) {
    lines.shift();
    out = lines.join("\n");
  }
  return out.slice(-SUMMARY_MAX);
}

/** "Make that shorter", "expand on it", "why?": a short message that refers back to the last answer. */
export function isFollowUp(q: string): boolean {
  const t = q.trim();
  if (!t || t.split(/\s+/).length > 14) return false;
  return /\b(that|this|it|those|them|above|previous|last|earlier|same|shorter|longer|shorten|expand|rephrase|rewrite|simplify|elaborate|more detail|again)\b/i.test(t);
}

export async function loadHistory(userId: number, conversationId: number): Promise<{ summary: string; recent: Turn[]; lastCitedDocs: number[] } | null> {
  const [c] = await query<{ summary: string; summary_msg_id: number }>("SELECT summary, summary_msg_id FROM kb_conversations WHERE id = $1 AND user_id = $2", [conversationId, userId]);
  if (!c) return null;
  const rows = await query<{ role: "user" | "assistant"; content: string; document_ids: number[] }>(
    "SELECT role, content, document_ids FROM kb_messages WHERE conversation_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT $3", [conversationId, userId, RECENT_MESSAGES]
  );
  rows.reverse();
  const lastAssistant = [...rows].reverse().find((r) => r.role === "assistant");
  return { summary: c.summary, recent: rows.map(({ role, content }) => ({ role, content })), lastCitedDocs: lastAssistant?.document_ids ?? [] };
}

/** Evidence the previous answer cited (owner-scoped), so a follow-up can reuse it. */
export async function seedFromDocuments(userId: number, ids: number[]): Promise<Hit[]> {
  if (!ids.length) return [];
  const rows = await query<any>("SELECT id, source_id, provider, doc_type, title, url, project, left(content, 1400) AS content, source_modified_at, synced_at FROM kb_documents WHERE user_id = $1 AND id = ANY($2::int[]) AND status = 'indexed' LIMIT 6", [userId, ids.slice(0, 6)]);
  return rows.map((d, i) => ({ chunkId: -(i + 9000), documentId: d.id, sourceId: d.source_id, provider: d.provider, docType: d.doc_type, title: d.title, url: d.url, project: d.project, locator: "previous answer", content: d.content, modifiedAt: null, syncedAt: new Date(d.synced_at).toISOString(), score: 1 }));
}

/** After a turn is saved: once enough unsummarised messages pile up, fold the old ones into the summary. */
export async function rollSummary(userId: number, conversationId: number): Promise<void> {
  const [c] = await query<{ summary: string; summary_msg_id: number }>("SELECT summary, summary_msg_id FROM kb_conversations WHERE id = $1 AND user_id = $2", [conversationId, userId]);
  if (!c) return;
  const rows = await query<{ id: number; role: "user" | "assistant"; content: string }>("SELECT id, role, content FROM kb_messages WHERE conversation_id = $1 AND user_id = $2 AND id > $3 ORDER BY id", [conversationId, userId, c.summary_msg_id]);
  if (rows.length <= ROLL_AFTER) return;
  const old = rows.slice(0, rows.length - RECENT_MESSAGES);
  await query("UPDATE kb_conversations SET summary = $3, summary_msg_id = $4 WHERE id = $1 AND user_id = $2", [conversationId, userId, summarizeTurns(c.summary, old), old[old.length - 1].id]);
}
