// GET  -> candidates awaiting review. POST { seed: true } or { records: [...] } -> stage for review. Creates NO application.
import { guard, json, err, readJson, str } from "@/lib/kb/api";
import { HISTORICAL_SEED, type RawCandidate } from "@/lib/applications/history";
import { listCandidates, stage } from "@/lib/applications/history-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, "read");
  if ("res" in g) return g.res;
  const state = new URL(req.url).searchParams.get("state");
  return json({ candidates: await listCandidates(g.user.id, ["pending", "confirmed", "skipped", "merged"].includes(state ?? "") ? state! : undefined) });
}

export async function POST(req: Request) {
  const g = await guard(req, "write");
  if ("res" in g) return g.res;
  const b = await readJson<{ seed?: boolean; records?: unknown }>(req, 100_000);
  if (!b) return err("invalid_request", 400);
  let raws: RawCandidate[];
  if (b.seed === true) raws = HISTORICAL_SEED;
  else if (Array.isArray(b.records)) {
    raws = b.records.slice(0, 200).map((r: any) => ({
      company: str(r?.company, 200), role: str(r?.role, 200) || null, contact: str(r?.contact, 254) || null,
      jobUrl: str(r?.jobUrl, 2000) || null, region: ["india", "international"].includes(r?.region) ? r.region : "unspecified",
    }));
  } else return err("invalid_request", 400);
  // user_id always comes from the session, never from the body.
  return json(await stage(g.user.id, raws, b.seed ? "historical_seed" : "manual"), 201);
}
