// Hybrid retrieval over the candidate's own knowledge: structured entities + PostgreSQL full-text search.
// Always scoped by user_id; optionally by source ids chosen in the UI. Bounded results, re-ranked in code.
import { query } from "@/lib/database";

const STOP = new Set("a an the and or of to in on for with is are was were be been how do does did i my me we our you your what why when where which who can could should would about explain describe tell give make this that these those it its as at by from into over under than then them they their there here have has had not no yes please using use used build built implement implemented implementation project projects".split(" "));

export function keywords(text: string, max = 14): string[] {
  const words = (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.\-_]{1,}/g) ?? []).map((w) => w.replace(/[.\-_]+$/, ""));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (STOP.has(w) || w.length < 2 || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out.slice(0, max);
}

export interface Hit {
  chunkId: number;
  documentId: number;
  sourceId: number;
  provider: string;
  docType: string;
  title: string;
  url: string | null;
  project: string | null;
  locator: string | null;
  content: string;
  modifiedAt: string | null;
  syncedAt: string;
  score: number;
}

const TYPE_WEIGHT: Record<string, number> = { readme: 1.2, doc: 1.15, manifest: 1.0, code: 1.0, resume: 1.1, profile: 1.05, coding_stats: 1.0, pull_request: 0.95, issue: 0.9, commits: 0.8, note: 1.0 };

export async function searchChunks(userId: number, q: string, opts: { sourceIds?: number[]; docTypes?: string[]; providers?: string[]; projects?: string[]; limit?: number } = {}): Promise<Hit[]> {
  const kws = keywords(q);
  if (!kws.length) return [];
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 30);
  // OR of quoted terms: a natural-language question rarely contains every word of the evidence.
  const tsq = kws.map((k) => `'${k.replace(/'/g, "''").replace(/[&|!<>():*\\]/g, " ").trim()}'`).filter((k) => k.length > 2).join(" | ");
  if (!tsq) return [];
  const params: unknown[] = [userId, tsq];
  let where = "c.user_id = $1 AND c.tsv @@ to_tsquery('english', $2) AND d.status = 'indexed'";
  if (opts.sourceIds?.length) {
    params.push(opts.sourceIds);
    where += ` AND d.source_id = ANY($${params.length}::int[])`;
  }
  if (opts.docTypes?.length) {
    params.push(opts.docTypes);
    where += ` AND d.doc_type = ANY($${params.length}::text[])`;
  }
  if (opts.providers?.length) {
    params.push(opts.providers);
    where += ` AND d.provider = ANY($${params.length}::text[])`;
  }
  if (opts.projects?.length) {
    params.push(opts.projects.map((p) => p.toLowerCase()));
    where += ` AND lower(d.project) = ANY($${params.length}::text[])`;
  }
  const rows = await query<any>(
    `SELECT c.id AS chunk_id, c.document_id, d.source_id, d.provider, d.doc_type, d.title, d.url, d.project, c.locator, c.content,
            d.source_modified_at, d.synced_at, ts_rank_cd(c.tsv, to_tsquery('english', $2), 32) AS rank
     FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id AND d.user_id = c.user_id
     WHERE ${where} ORDER BY rank DESC LIMIT ${limit * 3}`,
    params
  );
  const now = Date.now();
  const hits: Hit[] = rows.map((r: any) => {
    const ref = new Date(r.source_modified_at ?? r.synced_at).getTime();
    const ageDays = Math.max(0, (now - ref) / 86_400_000);
    const fresh = 1 + 0.15 * Math.exp(-ageDays / 365); // freshness: a mild boost, never decisive
    const reliable = r.provider === "github" || r.provider === "codeforces" ? 1.1 : 1.0; // source-derived beats pasted text
    const titleBoost = kws.some((k) => r.title.toLowerCase().includes(k) || (r.project ?? "").toLowerCase().includes(k)) ? 1.25 : 1;
    return {
      chunkId: Number(r.chunk_id), documentId: r.document_id, sourceId: r.source_id, provider: r.provider, docType: r.doc_type, title: r.title, url: r.url,
      project: r.project, locator: r.locator, content: r.content, modifiedAt: r.source_modified_at ? new Date(r.source_modified_at).toISOString() : null,
      syncedAt: new Date(r.synced_at).toISOString(), score: Number(r.rank) * (TYPE_WEIGHT[r.doc_type] ?? 1) * fresh * reliable * titleBoost,
    };
  });
  hits.sort((a, b) => b.score - a.score);
  // At most 3 chunks per document so one big file can't crowd out the rest.
  const per = new Map<number, number>();
  return hits.filter((h) => {
    const n = (per.get(h.documentId) ?? 0) + 1;
    per.set(h.documentId, n);
    return n <= 3;
  }).slice(0, limit);
}

/** Documents of a given type for the user (used for coding stats and project lookups). */
export async function documentsByType(userId: number, types: string[], opts: { sourceIds?: number[]; limit?: number } = {}) {
  const params: unknown[] = [userId, types];
  let sql = "SELECT id, source_id, provider, doc_type, title, url, project, left(content, 6000) AS content, source_modified_at, synced_at FROM kb_documents WHERE user_id = $1 AND doc_type = ANY($2::text[]) AND status = 'indexed'";
  if (opts.sourceIds?.length) {
    params.push(opts.sourceIds);
    sql += ` AND source_id = ANY($${params.length}::int[])`;
  }
  return query<any>(sql + ` ORDER BY synced_at DESC LIMIT ${Math.min(opts.limit ?? 10, 30)}`, params);
}

export async function listProjectNames(userId: number): Promise<string[]> {
  const rows = await query<{ name: string }>("SELECT name FROM kb_entities WHERE user_id = $1 AND kind = 'project' ORDER BY name", [userId]);
  return rows.map((r) => r.name);
}

/**
 * Portfolio overview: ONE representative document per project across the whole knowledge base (README preferred, then
 * docs, then manifest), plus the candidate's resume/profile/notes. Keyword search cannot answer "what are my projects?"
 * because the question has no content words; this lists what is actually indexed instead.
 * `providers` narrows to e.g. GitHub ("my projects from github"); `exclude` hides projects already discussed ("other projects").
 */
export async function projectOverview(userId: number, opts: { sourceIds?: number[]; providers?: string[]; exclude?: string[]; limit?: number } = {}): Promise<Hit[]> {
  const limit = Math.min(Math.max(opts.limit ?? 14, 1), 30);
  const params: unknown[] = [userId];
  let scope = "";
  if (opts.sourceIds?.length) (params.push(opts.sourceIds), (scope += ` AND d.source_id = ANY($${params.length}::int[])`));
  if (opts.providers?.length) (params.push(opts.providers), (scope += ` AND d.provider = ANY($${params.length}::text[])`));
  let excl = "";
  if (opts.exclude?.length) (params.push(opts.exclude.map((x) => x.toLowerCase())), (excl = ` AND lower(d.project) <> ALL($${params.length}::text[])`));
  const rows = await query<any>(
    `SELECT DISTINCT ON (lower(d.project)) d.id, d.source_id, d.provider, d.doc_type, d.title, d.url, d.project, left(d.content, 1500) AS content, d.source_modified_at, d.synced_at
     FROM kb_documents d
     WHERE d.user_id = $1 AND d.status = 'indexed' AND d.project IS NOT NULL AND d.doc_type IN ('readme','doc','manifest','note')${scope}${excl}
     ORDER BY lower(d.project), CASE d.doc_type WHEN 'readme' THEN 0 WHEN 'doc' THEN 1 WHEN 'note' THEN 2 ELSE 3 END, d.synced_at DESC
     LIMIT ${limit}`,
    params
  );
  const extra = opts.providers?.length
    ? []
    : await query<any>(
        `SELECT d.id, d.source_id, d.provider, d.doc_type, d.title, d.url, d.project, left(d.content, 5000) AS content, d.source_modified_at, d.synced_at
         FROM kb_documents d WHERE d.user_id = $1 AND d.status = 'indexed' AND d.project IS NULL AND d.doc_type IN ('resume','profile','note','doc')${scope}
         ORDER BY CASE d.doc_type WHEN 'resume' THEN 0 WHEN 'profile' THEN 1 ELSE 2 END, d.synced_at DESC LIMIT 4`,
        params.slice(0, opts.sourceIds?.length ? 2 : 1)
      );
  // Resume / profile first: they hold projects that never became a repository, and the evidence cap drops items from the END.
  return [...extra, ...rows].map((d: any, i: number) => ({
    chunkId: -(i + 1000), documentId: d.id, sourceId: d.source_id, provider: d.provider, docType: d.doc_type, title: d.title, url: d.url, project: d.project,
    locator: "overview", content: d.content, modifiedAt: d.source_modified_at ? new Date(d.source_modified_at).toISOString() : null, syncedAt: new Date(d.synced_at).toISOString(), score: 1,
  }));
}
