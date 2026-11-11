import { NextResponse } from "next/server";
import { loadArena } from "@/lib/arena";
import { overlayArenaJobs } from "@/lib/company-jobs/overlay";
import { listJobsForSlug } from "@/lib/company-jobs/store";
import { recoverCompanyLinks } from "@/lib/company-jobs/sync";
import { loadDbCompany } from "@/lib/company-jobs/directory";
import { query } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = loadArena().bySlug.get(slug);
  if (!c) {
    const d = await loadDbCompany(slug);
    if (!d) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ name: d.name, page: d.page, jobs: d.jobs, stale: d.stale });
  }
  let jobs = c.jobs;
  let stale = false;
  try {
    const dbJobs = await listJobsForSlug(slug);
    const [profile] = await query<{ jobs_stale: boolean }>("SELECT jobs_stale FROM company_profiles WHERE slug=$1", [slug]);
    stale = profile?.jobs_stale === true;
    if (dbJobs.length) jobs = overlayArenaJobs(c.jobs, dbJobs, stale);
  } catch {
    // Directory still works from the local snapshot when the database is down.
  }
  // No job has a real application link yet: ask the public source once (cooldown applies) and use what it returns.
  if (jobs.length && jobs.every((j) => !j.applicationUrl)) {
    const found = await Promise.race([recoverCompanyLinks(slug).catch(() => []), new Promise<never[]>((r) => setTimeout(() => r([]), 12_000))]);
    if (found.length) jobs = overlayArenaJobs(c.jobs, found, stale);
  }
  return NextResponse.json({ name: c.name, page: c.page, jobs, stale });
}
