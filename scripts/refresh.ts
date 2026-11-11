// CLI refresh for any scheduler that can run a command (Render Cron Job, systemd timer, crontab, CI job):
//   npm run refresh              → funding news, then startups/jobs discovery
//   npm run refresh -- news      → funding news only (fast)
//   npm run refresh -- discovery → startups/jobs only
// Exits non-zero if every provider failed, so the scheduler can alert you.
try {
  process.loadEnvFile(".env");
} catch {}
const scope = process.argv[2] ?? "all";

async function main() {
  if (!["all", "news", "discovery", "companies", "boards"].includes(scope)) {
    console.error(`Unknown scope "${scope}". Use: all | news | discovery | companies | boards`);
    process.exit(2);
  }
  let failures = 0;
  if (scope !== "discovery" && scope !== "companies" && scope !== "boards") {
    const { refreshNews } = await import("@/lib/news/refresh");
    const r = await refreshNews();
    if (!r.ran) console.log("news: skipped, another refresh holds the lock");
    else
      for (const p of r.report.providers) {
        console.log(`news/${p.id}: ${p.ok ? `ok (${p.inserted} new, ${p.updated} known, ${p.nearDuplicates} near-duplicates)` : `FAILED ${p.error}`} in ${p.durationMs}ms`);
        if (!p.ok) failures++;
      }
  }
  if (scope === "boards") {
    const { syncBoards } = await import("@/lib/company-jobs/boards-sync");
    const r = await syncBoards();
    console.log(r.ran ? JSON.stringify(r.stats) : "boards skipped, another sync holds the lock");
    if (!r.ran || (r.stats.boards > 0 && r.stats.boardsOk === 0)) failures++;
  } else if (scope === "companies") {
    const { syncCompanyJobs } = await import("@/lib/company-jobs/sync");
    const r = await syncCompanyJobs();
    console.log(r.ran ? JSON.stringify(r.stats) : "companies: skipped, another sync holds the lock");
    if (!r.ran || (r.stats.companies > 0 && r.stats.companiesOk === 0)) failures++;
  } else if (scope !== "news") {
    const { runDiscovery } = await import("@/lib/discovery/run");
    const s = await runDiscovery((line) => console.log(line));
    console.log(JSON.stringify(s.stats));
    if (s.stats.errors > 0) failures++;
  }
  const { pool } = await import("@/lib/database");
  await pool().end();
  process.exit(failures > 0 && ["news", "companies", "boards"].includes(scope) ? 1 : 0);
}
main().catch((e) => {
  console.error("refresh failed:", (e as Error).message);
  process.exit(1);
});
