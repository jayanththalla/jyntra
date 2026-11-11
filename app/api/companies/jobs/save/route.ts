import { NextResponse } from "next/server";
import { currentUser } from "@/lib/users";
import { rateLimit } from "@/lib/rate-limit";
import { query } from "@/lib/database";
import { loadArena } from "@/lib/arena";
import { applicationUrlOrNull } from "@/lib/company-jobs/urls";

export const dynamic = "force-dynamic";

/** POST { slug, jobId } — saves the company job using its real application URL. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "write");
  if (limited) return limited;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "no_profile" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const slug = typeof b.slug === "string" ? b.slug.trim().toLowerCase() : "";
  const jobId = typeof b.jobId === "string" ? b.jobId : "";
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug) || !jobId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const c = loadArena().bySlug.get(slug);
  const fileJob = c?.jobs.find((j) => j.id === jobId);
  let dbJob: { title: string; application_url: string | null } | undefined;
  try {
    [dbJob] = await query("SELECT title, application_url FROM company_jobs WHERE company_slug=$1 AND external_job_id=$2 LIMIT 1", [slug, jobId]);
  } catch {
    dbJob = undefined;
  }
  const title = dbJob?.title ?? fileJob?.title;
  if (!title) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const applicationUrl = applicationUrlOrNull(dbJob?.application_url ?? fileJob?.applicationUrl ?? null);
  const key = `company:${slug}:${jobId}`;
  const [existing] = await query("SELECT id FROM applications WHERE user_id=$1 AND import_key=$2", [user.id, key]);
  const rows = existing
    ? await query(
        `UPDATE applications SET status='Saved', application_url=COALESCE($3, application_url), updated_at=now()
         WHERE id=$1 AND user_id=$2 RETURNING *`,
        [existing.id, user.id, applicationUrl]
      )
    : await query(
        `INSERT INTO applications (user_id, startup_id, job_id, status, application_url, company_name, role_title, record_source, import_key)
         VALUES ($1, NULL, NULL, 'Saved', $2, $3, $4, 'company_directory', $5) RETURNING *`,
        [user.id, applicationUrl, c?.name ?? slug, title, key]
      );
  return NextResponse.json({ application: rows[0] });
}
