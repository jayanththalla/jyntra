// Incremental board discovery from the Internet Archive CDX index (public URLs only). Cursor = last timestamp seen, so a
// run only asks for captures newer than the previous one. Results are CANDIDATES; validation decides.
import { httpRequest } from "../http";
import { detectAts } from "../providers/detect";
import { addCandidate, getState, putState } from "./candidates";

const HOST_PATTERNS = ["boards.greenhouse.io/*", "jobs.lever.co/*", "jobs.ashbyhq.com/*", "apply.workable.com/*", "jobs.smartrecruiters.com/*"];

/** CDX `output=json` is an array of rows, the first being the field names. */
export function parseCdx(body: string): { url: string; timestamp: string }[] {
  let rows: unknown;
  try { rows = JSON.parse(body); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return (rows as string[][]).slice(1).filter((r) => Array.isArray(r) && r.length >= 2).map((r) => ({ url: String(r[0]), timestamp: String(r[1]) }));
}

export async function discoverFromCdx(o: { perPattern?: number } = {}): Promise<{ seen: number; added: number; cursor: string | null }> {
  const state = (await getState<{ cursor?: string }>("cdx")) ?? {};
  let cursor = state.cursor ?? null;
  let seen = 0, added = 0;
  for (const p of HOST_PATTERNS) {
    const qs = new URLSearchParams({ url: p, output: "json", fl: "original,timestamp", collapse: "urlkey", filter: "statuscode:200", limit: String(o.perPattern ?? 500) });
    if (state.cursor) qs.set("from", state.cursor.slice(0, 8));
    const r = await httpRequest(`https://web.archive.org/cdx/search/cdx?${qs}`, { timeoutMs: 30_000, maxBytes: 8_000_000 });
    for (const row of parseCdx(r.text)) {
      seen++;
      if (!cursor || row.timestamp > cursor) cursor = row.timestamp;
      const d = detectAts(row.url);
      if (!d || !d.boardSlug) continue;
      const res = await addCandidate({ name: d.boardSlug, provider: d.provider, boardSlug: d.boardSlug, tenant: d.tenant, host: d.host, careerSite: d.careerSite, origin: "cdx", originRef: row.url.slice(0, 200) });
      if (res.isNew) added++;
    }
  }
  if (cursor) await putState("cdx", { cursor });
  return { seen, added, cursor };
}
