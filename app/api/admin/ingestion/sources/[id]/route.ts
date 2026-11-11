import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/ingestion/auth";
import { sourceDetail } from "@/lib/ingestion/diagnostics";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Ingestion history + last fetch outcome for one source (admin only). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "cron"); if (limited) return limited;
  const a = checkAdmin(req);
  if (a === "not_configured") return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
  if (a === "denied") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const d = await sourceDetail(id);
  return d ? NextResponse.json(d) : NextResponse.json({ error: "not_found" }, { status: 404 });
}
