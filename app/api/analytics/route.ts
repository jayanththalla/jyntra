import { NextResponse } from "next/server";
import { AnalyticsUnavailableError, loadAnalytics } from "@/lib/analytics";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/analytics — metrics for the signed-in user (definitions live in lib/analytics). */
export async function GET(req: Request) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
    return NextResponse.json(await loadAnalytics(user.id));
  } catch (e) {
    // Never return database error text to the browser.
    if (e instanceof AnalyticsUnavailableError) return NextResponse.json({ error: "analytics_unavailable" }, { status: 503 });
    console.error("[api/analytics]", (e as Error).message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
