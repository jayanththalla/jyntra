import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/database";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/hyderabad?q=&industry=&hiring=1&page=1&limit=24
 * The Hyderabad startup directory (open MIT dataset, see sources/startupmaps). Read from the database, so it is as
 * fresh as the last refresh. Unlike /api/startups this is NOT limited to recently funded companies: it is a directory.
 * "Hiring" counts only jobs that a source saw within the last 2 days (jobs that disappear are marked inactive).
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  if (!(await currentUser())) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const page = Number(sp.get("page") ?? 1);
  const limit = Number(sp.get("limit") ?? 24);
  if (!Number.isInteger(page) || page < 1 || page > 500 || !Number.isInteger(limit) || limit < 1 || limit > 48) return NextResponse.json({ error: "invalid_paging" }, { status: 400 });
  const q = (sp.get("q") ?? "").trim().slice(0, 80);
  const industry = (sp.get("industry") ?? "").trim().slice(0, 40);
  const hiring = sp.get("hiring") === "1";

  const where = ["'startupmaps' = ANY(s.sources_seen)"];
  const args: unknown[] = [];
  if (q) {
    args.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(s.name ILIKE $${args.length} OR s.description ILIKE $${args.length} OR s.location ILIKE $${args.length})`);
  }
  if (industry) {
    args.push(industry);
    where.push(`s.industry = $${args.length}`);
  }
  const jobs = `LEFT JOIN (SELECT startup_id, count(*)::int AS n FROM jobs WHERE is_active AND last_seen_at > now() - interval '2 days' GROUP BY startup_id) j ON j.startup_id = s.id`;
  if (hiring) where.push("COALESCE(j.n, 0) > 0");
  const w = where.join(" AND ");

  try {
    const [[{ total }], rows, industries, [meta]] = await Promise.all([
      query<{ total: number }>(`SELECT count(*)::int AS total FROM startups s ${jobs} WHERE ${w}`, args),
      query(
        `SELECT s.id, s.name, s.website, s.careers_url, s.description, s.location, s.industry, s.founded_year, s.raw_tags, COALESCE(j.n, 0) AS open_jobs
         FROM startups s ${jobs} WHERE ${w} ORDER BY COALESCE(j.n, 0) DESC, s.name ASC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        args
      ),
      query<{ name: string; n: number }>("SELECT industry AS name, count(*)::int AS n FROM startups WHERE 'startupmaps' = ANY(sources_seen) AND industry IS NOT NULL GROUP BY 1 ORDER BY 2 DESC"),
      query<{ total: number; seen: Date | null }>("SELECT count(*)::int AS total, max(last_seen_at) AS seen FROM startups WHERE 'startupmaps' = ANY(sources_seen)"),
    ]);
    return NextResponse.json({
      total,
      page,
      limit,
      directoryTotal: meta?.total ?? 0,
      lastSeenAt: meta?.seen ? new Date(meta.seen).toISOString() : null,
      industries,
      startups: rows.map((r: any) => ({ ...r, open_jobs: Number(r.open_jobs), tags: r.raw_tags ?? [] })),
      attribution: { name: "Mapping HYD", license: "MIT", url: "https://github.com/shivtchandra/hydstartuplist", map: "https://startups.mapmyhyd.com/" },
    });
  } catch (e) {
    console.error("[api/hyderabad]", (e as Error).message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
