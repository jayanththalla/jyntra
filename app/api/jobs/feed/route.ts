import { NextResponse } from "next/server";
import { queryFeed } from "@/lib/ingestion/feed";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/jobs/feed — reads ONLY our database. Opening this never contacts any company site or ATS. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const u = new URL(req.url).searchParams;
  const num = (k: string) => { const v = u.get(k); return v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined; };
  try {
    const r = await queryFeed({
      city: u.get("city") ?? undefined, q: u.get("q")?.slice(0, 100) ?? undefined, role: u.get("role")?.slice(0, 40) ?? undefined, years: num("years"), type: u.get("type")?.slice(0, 40) ?? undefined,
      company: u.get("company")?.slice(0, 80) ?? undefined, postedWithinDays: num("postedWithinDays"), fresh: u.get("fresh") === "1", remoteOnly: u.get("remoteOnly") === "1", page: num("page"), pageSize: num("pageSize"),
    });
    return NextResponse.json(r, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } });
  } catch (e) {
    console.error("[api/jobs/feed]", (e as Error).message);
    return NextResponse.json({ error: "feed_unavailable" }, { status: 503 });
  }
}
