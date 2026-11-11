// Recomputes city classification for stored jobs from their OWN stored locations. No network. Used after a classifier change
// (e.g. adding Chennai) so existing rows are correct immediately instead of waiting for the next successful sync of each board.
import { query } from "@/lib/database";
import { classifyLocation } from "./location";
import type { WorkplaceType } from "./types";

export async function reclassifyJobs(o: { dryRun?: boolean; batch?: number } = {}): Promise<{ scanned: number; changed: number; byChange: Record<string, number> }> {
  let after = 0, scanned = 0, changed = 0;
  const byChange: Record<string, number> = {};
  const batch = o.batch ?? 1000;
  for (;;) {
    const rows = await query<{ id: number; locations: string[]; location: string | null; workplace_type: string | null; city_class: string | null; cities: string[]; remote_india: boolean }>(
      "SELECT id, locations, location, workplace_type, city_class, cities, remote_india FROM company_jobs WHERE source_id IS NOT NULL AND id > $1 ORDER BY id LIMIT $2", [after, batch]);
    if (!rows.length) break;
    for (const r of rows) {
      after = r.id; scanned++;
      const locs = r.locations?.length ? r.locations : r.location ? [r.location] : [];
      const cls = classifyLocation(locs, (r.workplace_type as WorkplaceType) ?? "unknown");
      const same = cls.cityClass === (r.city_class ?? "unknown") && cls.remoteIndia === r.remote_india && [...cls.cities].sort().join() === [...(r.cities ?? [])].sort().join();
      if (same) continue;
      changed++;
      const k = `${r.city_class ?? "unknown"} -> ${cls.cityClass}`;
      byChange[k] = (byChange[k] ?? 0) + 1;
      if (!o.dryRun) await query("UPDATE company_jobs SET city_class=$2, cities=$3::text[], remote_india=$4, content_hash=NULL WHERE id=$1", [r.id, cls.cityClass, cls.cities, cls.remoteIndia]);
    }
  }
  return { scanned, changed, byChange };
}
