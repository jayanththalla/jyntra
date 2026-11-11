import { NextResponse } from "next/server";
import { query } from "@/lib/database";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { matchProjects } from "@/lib/open-source/match";

export const dynamic = "force-dynamic";

/** The four product modules at a glance. Every number is a count or row from the database; the user-owned parts are scoped to the signed-in user. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "read"); if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "no_profile" }, { status: 401 });
  const skills: string[] = Array.isArray((user.profile as any)?.skills) ? (user.profile as any).skills.map(String).slice(0, 40) : [];
  const [sessions, contrib, kb, funding, oss] = await Promise.all([
    query<any>("SELECT id, role, type, level, mode, started_at, (report->>'overall')::int AS overall FROM interview_sessions WHERE user_id=$1 AND status='completed' ORDER BY started_at DESC LIMIT 3", [user.id]),
    query<any>("SELECT repo, issue_number, issue_title, cardinality(done_steps) AS done, saved, updated_at FROM oss_contributions WHERE user_id=$1 AND (saved OR cardinality(done_steps)>0) ORDER BY updated_at DESC LIMIT 4", [user.id]),
    query<any>("SELECT (SELECT count(*) FROM kb_documents WHERE user_id=$1 AND status='indexed')::int AS docs, (SELECT count(*) FROM kb_entities WHERE user_id=$1 AND kind='project')::int AS projects", [user.id]),
    query<any>("SELECT headline, company_name, funding_round, funding_amount, publisher, published_at, url FROM funding_articles ORDER BY published_at DESC NULLS LAST, first_ingested_at DESC LIMIT 3"),
    skills.length ? query<any>("SELECT repo, language, one_liner, repo_description, stars, issue_title, issue_url, beginner_issues FROM oss_projects WHERE beginner_issues > 0 ORDER BY fetched_at DESC LIMIT 300") : Promise.resolve([]),
  ]);
  const all = await query<any>("SELECT count(*)::int AS n, max((report->>'overall')::int) AS best, round(avg((report->>'overall')::int))::int AS avg FROM interview_sessions WHERE user_id=$1 AND status='completed'", [user.id]);
  // Last eight completed sessions, oldest first, for the progress chart (same table and filter as the counts above).
  const series = await query<any>("SELECT id, role, type, started_at, (report->>'overall')::int AS overall FROM (SELECT id, role, type, started_at, report FROM interview_sessions WHERE user_id=$1 AND status='completed' ORDER BY started_at DESC LIMIT 8) t WHERE report->>'overall' IS NOT NULL ORDER BY started_at ASC", [user.id]);
  return NextResponse.json({
    ok: true,
    interview: { completed: all[0].n, best: all[0].best, avg: all[0].avg, recent: sessions, series },
    openSource: { inProgress: contrib, forYou: matchProjects(oss, skills, 3), hasSkills: skills.length > 0 },
    atlas: { documents: kb[0].docs, projects: kb[0].projects },
    funding: funding.map((f: any) => ({ ...f, funding_amount: f.funding_amount || "Undisclosed" })),
  });
}
