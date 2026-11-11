// Companies that come from the database (city boards), as opposed to the Bengaluru snapshot file.
import { CITIES } from "./boards";
import { arenaJobFromRecord } from "./overlay";
import { listJobsForSlug } from "./store";
import { query } from "@/lib/database";
import type { ArenaJob, CompanyCard } from "@/lib/arena/shared";
import { shortLocation } from "@/lib/arena/shared";

const cityLabel = (id: string | null) => (id && CITIES[id]?.label) || null;

export async function dbCompanyCards(exclude: Set<string>): Promise<CompanyCard[]> {
  try {
    const rows = await query<{
      slug: string; name: string; city: string | null; c: string; f: string; r: string; rm: string;
      loc: string | null; fams: string[] | null; latest: string | null;
    }>(
      `SELECT p.slug, p.name, p.city,
              count(*)::text c,
              count(*) FILTER (WHERE j.fresher_friendly)::text f,
              count(*) FILTER (WHERE j.posted_at > now() - interval '30 days')::text r,
              count(*) FILTER (WHERE j.work_mode = 'remote')::text rm,
              mode() WITHIN GROUP (ORDER BY j.location) loc,
              array_agg(DISTINCT j.role_family) FILTER (WHERE j.role_family IS NOT NULL) fams,
              max(j.posted_at)::date::text latest
       FROM company_profiles p JOIN company_jobs j ON j.company_slug = p.slug AND j.is_active
       WHERE NOT (p.slug = ANY($1::text[]))
       GROUP BY p.slug, p.name, p.city
       HAVING count(*) > 0`,
      [[...exclude]]
    );
    return rows.map((r) => ({
      slug: r.slug, name: r.name, count: Number(r.c), fresher: Number(r.f), recent: Number(r.r), remote: Number(r.rm),
      families: r.fams ?? [], latest: r.latest, location: shortLocation(r.loc), logoSrc: `/api/companies/${r.slug}/logo`, city: cityLabel(r.city),
    }));
  } catch {
    return []; // database down: the directory still shows the snapshot
  }
}

export async function loadDbCompany(slug: string): Promise<{ slug: string; name: string; page: string; jobs: ArenaJob[]; stale: boolean } | null> {
  try {
    const [p] = await query<{ name: string; website: string | null; careers_url: string | null; jobs_stale: boolean }>(
      "SELECT name, website, careers_url, jobs_stale FROM company_profiles WHERE slug=$1", [slug]
    );
    if (!p) return null;
    const recs = await listJobsForSlug(slug);
    if (!recs.length) return null;
    return { slug, name: p.name, page: p.careers_url ?? p.website ?? "", jobs: recs.map((r) => arenaJobFromRecord(r, p.jobs_stale)), stale: p.jobs_stale };
  } catch {
    return null;
  }
}
