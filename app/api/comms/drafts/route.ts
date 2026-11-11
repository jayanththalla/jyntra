// GET -> drafts / sent messages (paginated). POST -> save a draft (never sends).
import { guard, json, err, readJson } from "@/lib/kb/api";
import { createDraft, listDrafts, publicDraft } from "@/lib/comms/store";
import { validateDraft } from "@/lib/comms/validate";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") === "sent" ? "sent" : sp.get("status") === "open" ? "open" : undefined;
  const id = (k: string) => { const v = sp.get(k); return v && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : null; };
  const rows = await listDrafts(g.user.id, { status, startupId: id("startup_id"), applicationId: id("application_id"), limit: Number(sp.get("limit") ?? 30) || 30, offset: Number(sp.get("offset") ?? 0) || 0 });
  return json({ drafts: rows.map(publicDraft) });
}

export async function POST(req: Request) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const b = await readJson<Record<string, unknown>>(req, 40_000);
  const v = b ? validateDraft(b, "save") : null;
  if (!v || !v.ok) return err(v && !v.ok ? v.error : "invalid_request", 400);
  return json({ draft: publicDraft(await createDraft(g.user.id, v.value)) }, 201);
}
