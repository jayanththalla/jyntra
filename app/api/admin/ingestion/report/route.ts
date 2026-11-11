import { NextResponse } from "next/server";
import { adminGate } from "@/lib/ingestion/gate";
import { buildIngestionReport } from "@/lib/ingestion/report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admin only. Every number is computed from database records (see lib/ingestion/report.ts). */
export async function GET(req: Request) {
  const g = adminGate(req); if (g) return g;
  try { return NextResponse.json(await buildIngestionReport()); }
  catch (e) { console.error("[admin/ingestion/report]", (e as Error).message); return NextResponse.json({ error: "unavailable" }, { status: 503 }); }
}
