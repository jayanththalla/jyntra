// Downloads the job listings of every company in data/blrarena-slugs.txt from the BLR Startup Arena jobs endpoint and writes
//   data/blrarena-jobs.json  and  data/blrarena-jobs.csv
// No database needed. Polite: 3 requests at a time with a short pause, bounded retries on 429/5xx (honours Retry-After), a timeout per
// request. A company with no jobs endpoint (404) or an empty list is counted, not treated as an error.
//   npx tsx scripts/fetch-blrarena-jobs.ts [--limit=20] [--only=pwc,adobe]
import fs from "node:fs";
import { arenaJob, prettyName } from "@/sources/jobs/blrarena";

const BASE = process.env.BLRARENA_BASE_URL || "https://www.blrstartuparena.com";
const CONCURRENCY = 3, PAUSE_MS = 250, TIMEOUT_MS = 20_000, RETRIES = 3;
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJobs(slug: string): Promise<{ status: "ok" | "none" | "failed"; jobs: any[]; note?: string }> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const r = await fetch(`${BASE}/api/companies/${slug}/jobs`, { headers: { Accept: "application/json", "User-Agent": "JyntraJobFetcher/1.0" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (r.status === 404) return { status: "none", jobs: [] };
      if (r.status === 429 || r.status >= 500) {
        const ra = Number(r.headers.get("retry-after"));
        if (attempt < RETRIES) { await sleep(Math.min(30_000, (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt) + Math.random() * 300)); continue; }
        return { status: "failed", jobs: [], note: `HTTP ${r.status}` };
      }
      if (!r.ok) return { status: "failed", jobs: [], note: `HTTP ${r.status}` };
      const data = await r.json();
      const arr = Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : null;
      if (!arr) return { status: "failed", jobs: [], note: "unexpected response shape" };
      return { status: arr.length ? "ok" : "none", jobs: arr };
    } catch (e) {
      if (attempt >= RETRIES) return { status: "failed", jobs: [], note: (e as Error).name };
      await sleep(1000 * 2 ** attempt);
    }
  }
  return { status: "failed", jobs: [] };
}

const csv = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

(async () => {
  let slugs = fs.readFileSync("data/blrarena-slugs.txt", "utf8").split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(s));
  const only = arg("only")?.split(",").map((s) => s.trim()); if (only) slugs = slugs.filter((s) => only.includes(s));
  const limit = Number(arg("limit")); if (limit > 0) slugs = slugs.slice(0, limit);
  console.log(`Fetching ${slugs.length} companies…`);
  const rows: Record<string, unknown>[] = [];
  const stats = { ok: 0, none: 0, failed: 0 };
  const failed: string[] = [];
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < slugs.length) {
      const slug = slugs[next++];
      const res = await getJobs(slug);
      stats[res.status]++;
      if (res.status === "failed") failed.push(`${slug} (${res.note})`);
      for (const j of res.jobs) {
        const m = arenaJob(j, slug);
        if (!m) continue;
        rows.push({ company: prettyName(slug), slug, title: m.title, location: m.location, work_mode: j.workMode ?? null, employment_type: m.employmentType, posted: m.postedDate, experience: m.minExperience, salary: m.salary, role_family: j.roleFamily ?? null, fresher_friendly: j.fresherFriendly ?? null, apply_url: m.applyUrl ?? null, application_url: m.applyUrl ?? null, company_page: m.sourceUrl, job_id: j.id ?? null, summary: m.description });
      }
      if (++done % 50 === 0) console.log(`  ${done}/${slugs.length} companies, ${rows.length} jobs so far`);
      await sleep(PAUSE_MS);
    }
  }));
  rows.sort((a, b) => String(b.posted ?? "").localeCompare(String(a.posted ?? "")));
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/blrarena-jobs.json", JSON.stringify({ fetched_at: new Date().toISOString(), source: BASE, companies: slugs.length, jobs: rows }, null, 2));
  const cols = Object.keys(rows[0] ?? { company: 1 });
  fs.writeFileSync("data/blrarena-jobs.csv", [cols.join(","), ...rows.map((r) => cols.map((c) => csv(r[c])).join(","))].join("\n") + "\n");
  console.log(`\nDone: ${rows.length} jobs from ${stats.ok} companies (${stats.none} had no jobs or no endpoint, ${stats.failed} failed).`);
  if (failed.length) console.log("Failed (run again to retry):", failed.slice(0, 20).join(", "), failed.length > 20 ? `…and ${failed.length - 20} more` : "");
  console.log("Wrote data/blrarena-jobs.json and data/blrarena-jobs.csv");
})();
