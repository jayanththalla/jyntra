// Persistence for the knowledge base. EVERY function takes userId and filters on it: a guessed id from
// another account matches nothing. Documents are idempotent: unchanged content (same hash) is not re-chunked.
import { extractResumeProjects, extractResumeSkills } from "./resume";
import crypto from "node:crypto";
import { query, withTransaction, type Q } from "@/lib/database";
import { safeHttpUrl } from "@/lib/url";
import { chunkText } from "./chunk";
import { redactSecrets } from "./safety";
import type { DocType, Provider, RawDoc } from "./types";

export const hashContent = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const MAX_DOC_CHARS = 200_000;

export interface SourceRow {
  id: number;
  user_id: number;
  provider: Provider;
  label: string;
  status: string;
  config: Record<string, any>;
  credentials_enc: string | null;
  last_synced_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  last_stats: Record<string, any>;
  cancel_requested: boolean;
  created_at: string;
}

/** What the browser may see: never credentials. */
export function publicSource(s: SourceRow & { doc_count?: number }) {
  const { credentials_enc, user_id, ...rest } = s;
  const config = { ...rest.config };
  delete config.importText; // large pasted exports stay server-side
  delete config.text;
  return { ...rest, config, has_credentials: !!credentials_enc };
}

export async function audit(userId: number, action: string, sourceId: number | null = null, detail: string | null = null) {
  await query("INSERT INTO kb_audit (user_id, action, source_id, detail) VALUES ($1,$2,$3,$4)", [userId, action, sourceId, detail?.slice(0, 200) ?? null]).catch(() => {});
}

export async function listSources(userId: number) {
  return query<SourceRow & { doc_count: number }>(
    `SELECT s.*, (SELECT count(*)::int FROM kb_documents d WHERE d.source_id = s.id AND d.user_id = s.user_id) AS doc_count
     FROM kb_sources s WHERE s.user_id = $1 AND s.status <> 'disconnected' ORDER BY s.id`,
    [userId]
  );
}

export async function getSource(userId: number, id: number): Promise<SourceRow | null> {
  if (!Number.isInteger(id)) return null;
  const [s] = await query<SourceRow>("SELECT * FROM kb_sources WHERE id = $1 AND user_id = $2", [id, userId]);
  return s ?? null;
}

export async function createSource(userId: number, p: { provider: Provider; label: string; config?: Record<string, unknown>; credentialsEnc?: string | null; status?: string }) {
  const [s] = await query<SourceRow>(
    "INSERT INTO kb_sources (user_id, provider, label, config, credentials_enc, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [userId, p.provider, p.label.slice(0, 120), JSON.stringify(p.config ?? {}), p.credentialsEnc ?? null, p.status ?? "pending"]
  );
  await audit(userId, "source_created", s.id, p.provider);
  return s;
}

export interface UpsertStats {
  added: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  failed: number;
  removed: number;
  redactions: number;
}

const emptyStats = (): UpsertStats => ({ added: 0, updated: 0, unchanged: 0, duplicates: 0, failed: 0, removed: 0, redactions: 0 });

/**
 * Stores one source's documents. Idempotent: same externalId + same hash => nothing rewritten.
 * Same content already indexed from ANOTHER source of this user => skipped as a duplicate (logged in stats).
 * When `complete`, documents of this source that the listing no longer contains are deleted (deleted/inaccessible at source).
 */
export async function storeDocuments(userId: number, sourceId: number, provider: Provider, docs: RawDoc[], opts: { complete: boolean }): Promise<UpsertStats> {
  const stats = emptyStats();
  const seen = new Set<string>();
  for (const raw of docs) {
    if (!raw.externalId || !raw.title) {
      stats.failed++;
      continue;
    }
    seen.add(raw.externalId);
    try {
      const red = redactSecrets((raw.content ?? "").slice(0, MAX_DOC_CHARS));
      stats.redactions += red.redactions;
      const content = red.text.trim();
      if (!content) {
        stats.failed++;
        continue;
      }
      const hash = hashContent(content);
      await withTransaction(async (q) => {
        await q("SELECT pg_advisory_xact_lock(hashtext($1))", [`kb:doc:${userId}:${sourceId}:${raw.externalId}`]);
        const [existing] = await q<{ id: number; content_hash: string }>("SELECT id, content_hash FROM kb_documents WHERE source_id = $1 AND user_id = $2 AND external_id = $3", [sourceId, userId, raw.externalId]);
        if (existing && existing.content_hash === hash) {
          await q("UPDATE kb_documents SET synced_at = now(), source_modified_at = COALESCE($2::timestamptz, source_modified_at) WHERE id = $1", [existing.id, raw.modifiedAt ?? null]);
          stats.unchanged++;
          return;
        }
        if (!existing && raw.docType !== "coding_stats") {
          const [dup] = await q<{ id: number }>("SELECT id FROM kb_documents WHERE user_id = $1 AND content_hash = $2 AND source_id <> $3 LIMIT 1", [userId, hash, sourceId]);
          if (dup) {
            stats.duplicates++;
            return;
          }
        }
        const meta = JSON.stringify(raw.metadata ?? {});
        const params = [userId, sourceId, provider, raw.docType, raw.externalId, raw.title.slice(0, 300), safeHttpUrl(raw.url ?? null), raw.project?.slice(0, 200) ?? null, content, hash, meta, raw.modifiedAt ?? null];
        let id: number;
        if (existing) {
          id = existing.id;
          await q(
            `UPDATE kb_documents SET source_id=$2, provider=$3, external_id=$5, doc_type=$4, title=$6, url=$7, project=$8, content=$9, content_hash=$10, metadata=$11, source_modified_at=$12, synced_at=now(), status='indexed', error=NULL
             WHERE id = $13 AND user_id = $1`,
            [...params, id]
          );
          await q("DELETE FROM kb_chunks WHERE document_id = $1 AND user_id = $2", [id, userId]);
          stats.updated++;
        } else {
          const [row] = await q<{ id: number }>(
            `INSERT INTO kb_documents (user_id, source_id, provider, doc_type, external_id, title, url, project, content, content_hash, metadata, source_modified_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            params
          );
          id = row.id;
          stats.added++;
        }
        const chunks = chunkText(content, raw.docType === "code" || raw.docType === "manifest" ? "code" : "prose");
        for (const c of chunks) await q("INSERT INTO kb_chunks (user_id, document_id, idx, locator, content) VALUES ($1,$2,$3,$4,$5)", [userId, id, c.idx, c.locator, c.content]);
      });
    } catch (e) {
      stats.failed++;
      console.error("[kb] document failed:", (e as Error).message.slice(0, 120));
    }
  }
  if (opts.complete) {
    const rows = await query<{ id: number; external_id: string }>("SELECT id, external_id FROM kb_documents WHERE source_id = $1 AND user_id = $2", [sourceId, userId]);
    const gone = rows.filter((r) => !seen.has(r.external_id)).map((r) => r.id);
    if (gone.length) {
      await deleteDocuments(userId, gone);
      stats.removed = gone.length;
    }
  }
  return stats;
}

/** Deletes documents and everything derived from them: chunks (cascade), saved answers and notes that cite them. */
export async function deleteDocuments(userId: number, ids: number[]) {
  if (!ids.length) return;
  await withTransaction(async (q) => {
    await deleteDerived(q, userId, ids);
    await q("DELETE FROM kb_documents WHERE user_id = $1 AND id = ANY($2::int[])", [userId, ids]);
  });
  await rebuildEntities(userId);
}

async function deleteDerived(q: Q, userId: number, ids: number[]) {
  // Messages and notes that were built from this evidence are removed, so nothing derived outlives its source.
  await q("DELETE FROM kb_messages WHERE user_id = $1 AND document_ids && $2::int[]", [userId, ids]);
  await q("DELETE FROM kb_notes WHERE user_id = $1 AND document_ids && $2::int[]", [userId, ids]);
  await q("DELETE FROM kb_conversations c WHERE c.user_id = $1 AND NOT EXISTS (SELECT 1 FROM kb_messages m WHERE m.conversation_id = c.id)", [userId]);
}

/** Disconnect: stop syncing, drop the credential, and (optionally) delete everything indexed from it. */
export async function disconnectSource(userId: number, sourceId: number, purge: boolean): Promise<boolean> {
  const src = await getSource(userId, sourceId);
  if (!src) return false;
  if (purge) {
    const docs = await query<{ id: number }>("SELECT id FROM kb_documents WHERE source_id = $1 AND user_id = $2", [sourceId, userId]);
    await deleteDocuments(userId, docs.map((d) => d.id));
    await query("DELETE FROM kb_sources WHERE id = $1 AND user_id = $2", [sourceId, userId]);
  } else {
    await query("UPDATE kb_sources SET status = 'disconnected', credentials_enc = NULL, cancel_requested = true, updated_at = now() WHERE id = $1 AND user_id = $2", [sourceId, userId]);
  }
  await audit(userId, purge ? "source_deleted" : "source_disconnected", sourceId);
  return true;
}

/** Deletes the candidate's whole knowledge base (sources, documents, entities, conversations, notes). */
export async function deleteAllKnowledge(userId: number) {
  await withTransaction(async (q) => {
    await q("DELETE FROM kb_messages WHERE user_id = $1", [userId]);
    await q("DELETE FROM kb_conversations WHERE user_id = $1", [userId]);
    await q("DELETE FROM kb_notes WHERE user_id = $1", [userId]);
    await q("DELETE FROM kb_entities WHERE user_id = $1", [userId]);
    await q("DELETE FROM kb_chunks WHERE user_id = $1", [userId]);
    await q("DELETE FROM kb_documents WHERE user_id = $1", [userId]);
    await q("DELETE FROM kb_sources WHERE user_id = $1", [userId]);
  });
  await audit(userId, "all_deleted");
}

// ---------------------------------------------------------------------------------------------
// Entities: projects, skills, coding... derived from documents + the profile, with an evidence level.
// ---------------------------------------------------------------------------------------------
const RANK: Record<string, number> = { demonstrated: 3, self_reported: 2, inferred: 1, unverified: 0 };

export async function rebuildEntities(userId: number) {
  const [user] = await query<{ profile: any }>("SELECT profile FROM users WHERE id = $1", [userId]);
  const docs = await query<{ id: number; doc_type: DocType; provider: string; title: string; project: string | null; metadata: any; content: string }>(
    "SELECT id, doc_type, provider, title, project, metadata, left(content, 20000) AS content FROM kb_documents WHERE user_id = $1 AND status = 'indexed'",
    [userId]
  );
  type E = { kind: string; name: string; level: string; data: Record<string, unknown>; ids: Set<number> };
  const ents = new Map<string, E>();
  const put = (kind: string, name: string, level: string, id: number | null, data: Record<string, unknown> = {}) => {
    const clean = name.trim().slice(0, 120);
    if (!clean) return;
    const k = `${kind}:${clean.toLowerCase()}`;
    const cur = ents.get(k);
    if (!cur) ents.set(k, { kind, name: clean, level, data: { ...data }, ids: new Set(id ? [id] : []) });
    else {
      if (RANK[level] > RANK[cur.level]) cur.level = level;
      if (id) cur.ids.add(id);
      Object.assign(cur.data, data);
    }
  };

  // Self-reported: the candidate's own profile.
  const p = user?.profile ?? {};
  for (const s of [...(p.skills ?? []), ...(p.programming_languages ?? []), ...(p.frameworks ?? []), ...(p.databases ?? []), ...(p.cloud_tools ?? [])]) if (typeof s === "string") put("skill", s, "self_reported", null);
  for (const pr of p.projects ?? []) if (pr?.name) put("project", String(pr.name), "self_reported", null, { description: pr.description ?? null });

  for (const d of docs) {
    const techs: string[] = Array.isArray(d.metadata?.technologies) ? d.metadata.technologies : [];
    if (d.project && (d.provider === "github" || d.provider === "portfolio")) {
      put("project", d.project, "demonstrated", d.id, { provider: d.provider });
      for (const t of techs) {
        put("skill", t, "demonstrated", d.id, {});
        const proj = ents.get(`project:${d.project.toLowerCase()}`);
        if (proj) proj.data.technologies = [...new Set([...(proj.data.technologies as string[] ?? []), t])];
      }
      if (d.metadata?.language) put("skill", String(d.metadata.language), "demonstrated", d.id);
    }
    if (d.doc_type === "coding_stats") {
      put("coding", d.title, "inferred", d.id, { provider: d.provider });
      for (const t of techs) put("skill", t, "inferred", d.id);
    }
    if (d.doc_type === "resume" || d.doc_type === "profile") {
      // A claim in a document: only adds skills we know about from elsewhere, or marks them unverified.
      for (const t of techs) put("skill", t, "unverified", d.id);
      // The resume is the candidate's own account: its projects and skills count as self-reported (a repository can raise them to "demonstrated").
      if (d.doc_type === "resume") {
        for (const pr of extractResumeProjects(d.content)) {
          put("project", pr.name, "self_reported", d.id);
          const e = ents.get(`project:${pr.name.toLowerCase()}`)!;
          // Fill gaps only: a repository's own provider/technologies are better evidence than the resume's wording.
          e.data.provider ??= "resume";
          e.data.technologies = [...new Set([...((e.data.technologies as string[]) ?? []), ...pr.tech])];
          if (pr.description) e.data.description ??= pr.description;
        }
        for (const sk of extractResumeSkills(d.content)) put("skill", sk, "self_reported", d.id);
      }
      if (/experience|intern/i.test(d.title + d.content.slice(0, 400))) put("experience", d.title, "unverified", d.id);
      if (/education|b\.?tech|bachelor|master|university/i.test(d.title)) put("education", d.title, "unverified", d.id);
    }
  }
  await withTransaction(async (q) => {
    await q("DELETE FROM kb_entities WHERE user_id = $1", [userId]);
    for (const e of ents.values())
      await q("INSERT INTO kb_entities (user_id, kind, name, level, data, document_ids) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [userId, e.kind, e.name, e.level, JSON.stringify(e.data), [...e.ids]]);
  });
}

export async function listEntities(userId: number) {
  return query<{ id: number; kind: string; name: string; level: string; data: any; document_ids: number[] }>(
    "SELECT id, kind, name, level, data, document_ids FROM kb_entities WHERE user_id = $1 ORDER BY kind, name",
    [userId]
  );
}
