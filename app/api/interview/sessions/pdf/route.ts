import { NextResponse } from "next/server";
import { guard, json } from "@/lib/interview/http";
import { getStoredReport } from "@/lib/interview/sessions-v2";
import { renderReportPdf } from "@/lib/interview/pdf";
import { query } from "@/lib/database";
export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const maxDuration = 60;

/** GET ?id=N → the saved report of the user's own COMPLETED interview as a PDF. Version-1 (older) reports get a clear 409, not a fake PDF. */
export async function GET(req: Request) {
  const g = await guard(req, "interviewPdf"); if ("res" in g) return g.res;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return json({ ok: false, error: "invalid_id" }, 400);
  const stored = await getStoredReport(g.user.id, id);
  if (!stored) return json({ ok: false, error: "not_found" }, 404);
  if (stored.version !== 2) return json({ ok: false, error: "legacy_report", message: "This interview was saved in the older report format, which has no PDF layout. Its scores and feedback are unchanged and still viewable." }, 409);
  const pdf = await renderReportPdf(stored.report, { candidate: (g.user.profile as { name?: string }).name ?? null });
  await query("UPDATE interview_sessions SET pdf_generated_at=now() WHERE id=$1 AND user_id=$2", [id, g.user.id]).catch(() => {});
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="jyntra-interview-report-${id}.pdf"`, "Cache-Control": "private, no-store" } });
}
