import { NextResponse } from "next/server";
import { addBoard, addCompany, pauseSource, reactivateSource, retrySource, validateSourceNow } from "@/lib/ingestion/admin";
import { checkAdmin } from "@/lib/ingestion/auth";
import { ingestionDiagnostics, listSources } from "@/lib/ingestion/diagnostics";
import { NOT_IMPLEMENTED, PROVIDER_META } from "@/lib/ingestion/providers";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function gate(req: Request) {
  const limited = rateLimit(req, "cron");
  if (limited) return limited;
  const a = checkAdmin(req);
  if (a === "not_configured") return NextResponse.json({ error: "admin_not_configured" }, { status: 503 });
  if (a === "denied") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

/** Admin only (Bearer JOB_SYNC_SECRET). Never returns credentials, raw headers or tokens. */
export async function GET(req: Request) {
  const g = gate(req); if (g) return g;
  try {
    return NextResponse.json({ diagnostics: await ingestionDiagnostics(), sources: await listSources(), providers: PROVIDER_META.map((m) => ({ provider: m.provider, label: m.label, documented: m.documented })), notImplemented: NOT_IMPLEMENTED });
  } catch (e) { console.error("[admin/ingestion]", (e as Error).message); return NextResponse.json({ error: "unavailable" }, { status: 503 }); }
}

export async function POST(req: Request) {
  const g = gate(req); if (g) return g;
  let b: Record<string, any>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const id = Number(b.sourceId);
  try {
    switch (b.action) {
      case "addCompany": return NextResponse.json(await addCompany({ name: String(b.name ?? ""), careersUrl: b.careersUrl, website: b.website }));
      case "addBoard": return NextResponse.json(await addBoard({ companyName: String(b.companyName ?? ""), provider: String(b.provider ?? ""), boardSlug: b.boardSlug, tenant: b.tenant, host: b.host, careerSite: b.careerSite, priority: b.priority === "high" ? "high" : "normal", pollIntervalMinutes: Number(b.pollIntervalMinutes) || undefined }));
      case "validate": case "retry": case "pause": case "reactivate": {
        if (!Number.isInteger(id)) return NextResponse.json({ error: "sourceId required" }, { status: 400 });
        const r = b.action === "validate" ? await validateSourceNow(id) : b.action === "retry" ? await retrySource(id) : b.action === "pause" ? await pauseSource(id) : await reactivateSource(id);
        return NextResponse.json(r);
      }
      default: return NextResponse.json({ error: "unknown_action" }, { status: 400 });
    }
  } catch (e) { console.error("[admin/ingestion]", (e as Error).message); return NextResponse.json({ error: "action_failed" }, { status: 500 }); }
}
