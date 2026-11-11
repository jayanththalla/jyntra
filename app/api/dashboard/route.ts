import { NextResponse } from "next/server";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { loadDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = rateLimit(req, "read");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  try {
    return NextResponse.json(await loadDashboard(user));
  } catch (e) {
    console.error("[api/dashboard]", (e as Error).message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
