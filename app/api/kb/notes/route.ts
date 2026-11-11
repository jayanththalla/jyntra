// Saved answers / interview notes / job descriptions, optionally attached to one of the user's applications.
import { guard, json, err, readJson, str, toId } from "@/lib/kb/api";
import { query } from "@/lib/database";

export const dynamic = "force-dynamic";
const KINDS = ["interview_note", "prep", "job_description", "question", "answer"];

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const appId = toId(new URL(req.url).searchParams.get("application_id"));
  const rows = await query(
    `SELECT id, application_id, kind, title, content, citations, created_at, updated_at FROM kb_notes WHERE user_id = $1 ${appId ? "AND application_id = $2" : ""} ORDER BY created_at DESC LIMIT 100`,
    appId ? [g.user.id, appId] : [g.user.id]
  );
  return json({ notes: rows });
}

export async function POST(req: Request) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const b = await readJson<Record<string, any>>(req, 80_000);
  if (!b) return err("invalid_request", 400);
  const title = str(b.title, 160);
  const content = str(b.content, 40_000);
  if (!title || !content) return err("invalid_request", 400, "A note needs a title and some content.");
  const kind = KINDS.includes(b.kind) ? b.kind : "interview_note";
  const appId = toId(b.application_id);
  if (appId) {
    const [a] = await query("SELECT id FROM applications WHERE id = $1 AND user_id = $2", [appId, g.user.id]);
    if (!a) return err("not_found", 404, "Application not found.");
  }
  // Citations are only trusted if they point to this user's documents.
  const cites = Array.isArray(b.citations) ? b.citations.slice(0, 12) : [];
  const docIds = cites.map((c: any) => toId(c?.documentId)).filter((x: number | null): x is number => !!x);
  const owned = docIds.length ? (await query<{ id: number }>("SELECT id FROM kb_documents WHERE user_id = $1 AND id = ANY($2::int[])", [g.user.id, docIds])).map((r) => r.id) : [];
  const safeCites = cites.filter((c: any) => owned.includes(toId(c?.documentId) ?? -1)).map((c: any) => ({ id: str(c.id, 8), title: str(c.title, 200), url: /^https?:\/\//.test(c.url ?? "") ? str(c.url, 500) : null, locator: str(c.locator, 80), documentId: toId(c.documentId), provider: str(c.provider, 20), docType: str(c.docType, 20), snippet: str(c.snippet, 240) }));
  const [n] = await query("INSERT INTO kb_notes (user_id, application_id, kind, title, content, citations, document_ids) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, application_id, kind, title, content, citations, created_at, updated_at", [g.user.id, appId, kind, title, content, JSON.stringify(safeCites), owned]);
  return json({ note: n }, 201);
}
