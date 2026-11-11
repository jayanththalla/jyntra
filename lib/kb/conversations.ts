import { query } from "@/lib/database";
import type { Citation } from "./answer";

export async function saveExchange(userId: number, p: { conversationId?: number | null; mode: string; question: string; answer: string; citations: Citation[]; meta: Record<string, unknown> }) {
  let convId = p.conversationId ?? null;
  if (convId) {
    const [c] = await query("SELECT id FROM kb_conversations WHERE id = $1 AND user_id = $2", [convId, userId]);
    if (!c) convId = null; // not theirs or gone: start a fresh one rather than attach to someone else's
  }
  if (!convId) {
    const [c] = await query<{ id: number }>("INSERT INTO kb_conversations (user_id, title, mode) VALUES ($1,$2,$3) RETURNING id", [userId, p.question.replace(/\s+/g, " ").slice(0, 80) || "Conversation", p.mode]);
    convId = c.id;
  }
  const docIds = [...new Set(p.citations.map((c) => c.documentId).filter((x): x is number => !!x))];
  await query("INSERT INTO kb_messages (user_id, conversation_id, role, content) VALUES ($1,$2,'user',$3)", [userId, convId, p.question.slice(0, 12000)]);
  const [m] = await query<{ id: number }>(
    "INSERT INTO kb_messages (user_id, conversation_id, role, content, citations, meta, document_ids) VALUES ($1,$2,'assistant',$3,$4,$5,$6) RETURNING id",
    [userId, convId, p.answer, JSON.stringify(p.citations), JSON.stringify(p.meta), docIds]
  );
  await query("UPDATE kb_conversations SET updated_at = now() WHERE id = $1 AND user_id = $2", [convId, userId]);
  return { conversationId: convId, messageId: m.id };
}

/** Escapes LIKE wildcards so a search for "100%" or "a_b" is literal. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/** Paginated; with `search`, matches the title or any message of the user's own conversations (parameterised). */
export const listConversations = (userId: number, limit = 30, offset = 0, search = "") => {
  const q = search.trim().slice(0, 100);
  const lim = Math.min(Math.max(limit, 1), 50);
  const off = Math.max(offset, 0);
  if (!q) return query("SELECT id, title, mode, created_at, updated_at FROM kb_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3", [userId, lim, off]);
  const pat = `%${likeEscape(q)}%`;
  return query(
    `SELECT c.id, c.title, c.mode, c.created_at, c.updated_at FROM kb_conversations c
     WHERE c.user_id = $1 AND (c.title ILIKE $2 OR EXISTS (SELECT 1 FROM kb_messages m WHERE m.conversation_id = c.id AND m.user_id = c.user_id AND m.content ILIKE $2))
     ORDER BY c.updated_at DESC LIMIT $3 OFFSET $4`,
    [userId, pat, lim, off]
  );
};

export async function renameConversation(userId: number, id: number, title: string) {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!t) return false;
  return (await query("UPDATE kb_conversations SET title = $3 WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId, t])).length > 0;
}

export async function getConversation(userId: number, id: number) {
  const [c] = await query("SELECT id, title, mode, created_at, updated_at FROM kb_conversations WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!c) return null;
  const messages = await query("SELECT id, role, content, citations, meta, created_at FROM kb_messages WHERE conversation_id = $1 AND user_id = $2 ORDER BY id", [id, userId]);
  return { ...c, messages };
}

export async function deleteConversation(userId: number, id: number, opts: { alsoFacts?: boolean } = {}) {
  // Facts the candidate saved from this chat are kept unless they ask for them to go too.
  if (opts.alsoFacts) await query("DELETE FROM kb_facts WHERE conversation_id = $1 AND user_id = $2", [id, userId]);
  const r = await query("DELETE FROM kb_conversations WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]);
  return r.length > 0;
}
