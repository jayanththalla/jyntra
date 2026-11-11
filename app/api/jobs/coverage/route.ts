import { NextResponse } from "next/server";
import { coverageSummary } from "@/lib/ingestion/coverage";
import { rateLimit } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
/** GET /api/jobs/coverage — database only: how many employer boards are watched and when they last refreshed. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "read"); if (limited) return limited;
  try { return NextResponse.json(await coverageSummary(), { headers: { "Cache-Control": "public, max-age=60" } }); }
  catch { return NextResponse.json({ error: "unavailable" }, { status: 503 }); }
}
