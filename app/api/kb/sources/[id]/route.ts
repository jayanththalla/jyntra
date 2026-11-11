import { guard, json, err, readJson, toId } from "@/lib/kb/api";
import { disconnectSource, getSource, publicSource } from "@/lib/kb/store";
import { syncInBackground } from "@/lib/kb/sync";
import { query } from "@/lib/database";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const s = id ? await getSource(g.user.id, id) : null;
  return s ? json({ source: publicSource(s) }) : err("not_found", 404);
}

/** POST { action: "sync" | "cancel" } */
export async function POST(req: Request, { params }: Ctx) {
  const g = await guard(req, "kbSync");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  const s = id ? await getSource(g.user.id, id) : null;
  if (!s) return err("not_found", 404);
  const b = await readJson<{ action?: string }>(req, 2000);
  if (b?.action === "cancel") {
    await query("UPDATE kb_sources SET cancel_requested = true WHERE id = $1 AND user_id = $2", [s.id, g.user.id]);
    return json({ ok: true });
  }
  if (b?.action !== "sync") return err("invalid_request", 400);
  if (s.status === "disconnected") return err("disconnected", 409, "Reconnect this source first.");
  if (s.status === "syncing") return err("already_running", 409, "A sync is already running.");
  syncInBackground(g.user.id, s.id);
  return json({ ok: true, started: true }, 202);
}

/** DELETE ?purge=1 removes the source AND everything indexed from it (and answers/notes built from it). Without purge it only disconnects. */
export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const id = toId((await params).id);
  if (!id) return err("not_found", 404);
  const purge = new URL(req.url).searchParams.get("purge") === "1";
  return (await disconnectSource(g.user.id, id, purge)) ? json({ ok: true, purged: purge }) : err("not_found", 404);
}
