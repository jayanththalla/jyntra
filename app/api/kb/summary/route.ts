// Knowledge profile + dashboard widget data. Counts come straight from the database; a failed source is reported as failed.
import { guard, json } from "@/lib/kb/api";
import { query } from "@/lib/database";
import { listEntities, listSources, publicSource } from "@/lib/kb/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const uid = g.user.id;
  const [sources, entities, [counts], notes] = await Promise.all([
    listSources(uid),
    listEntities(uid),
    query<{ documents: number; chunks: number; resumes: number }>(
      "SELECT (SELECT count(*)::int FROM kb_documents WHERE user_id = $1) documents, (SELECT count(*)::int FROM kb_chunks WHERE user_id = $1) chunks, (SELECT count(*)::int FROM kb_documents WHERE user_id = $1 AND doc_type = 'resume') resumes",
      [uid]
    ),
    query("SELECT id, title, kind, created_at FROM kb_notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3", [uid]),
  ]);
  const byKind = (k: string) => entities.filter((e) => e.kind === k);
  const lastOk = sources.filter((s) => s.last_synced_at).map((s) => s.last_synced_at!).sort().pop() ?? null;
  const unhealthy = sources.filter((s) => s.status === "error" || s.status === "revoked");
  const actions: string[] = [];
  if (!sources.length) actions.push("Connect GitHub or upload your resume so answers can use your real experience.");
  if (sources.length && !sources.some((s) => s.provider === "github")) actions.push("Connect GitHub to enable project walkthroughs and interview coaching.");
  if (sources.length && !(counts?.resumes > 0)) actions.push("Upload your resume to improve ATS and job-match advice.");
  if (sources.length && !sources.some((s) => ["codeforces", "leetcode"].includes(s.provider))) actions.push("Add a Codeforces handle or a LeetCode export for a practice plan.");
  for (const s of unhealthy) actions.push(`Fix "${s.label}": ${s.last_error ?? "last sync failed"}`);
  const weak = byKind("skill").filter((e) => e.level === "self_reported" || e.level === "unverified").length;
  if (weak) actions.push(`${weak} skill${weak > 1 ? "s are" : " is"} listed but not backed by any project or code yet.`);
  return json({
    sources: sources.map(publicSource),
    totals: { sources: sources.length, documents: counts?.documents ?? 0, chunks: counts?.chunks ?? 0, projects: byKind("project").length, skills: byKind("skill").length, notes: notes.length },
    last_successful_sync: lastOk,
    unhealthy: unhealthy.map((s) => ({ id: s.id, label: s.label, status: s.status, error: s.last_error })),
    projects: byKind("project").map((e) => ({ name: e.name, level: e.level, technologies: e.data?.technologies ?? [] })),
    skills: byKind("skill").map((e) => ({ name: e.name, level: e.level })),
    coding: byKind("coding").map((e) => ({ name: e.name, level: e.level })),
    recent_notes: notes,
    recommended_actions: actions.slice(0, 5),
  });
}
