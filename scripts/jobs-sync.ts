// One bounded ingestion run for cron / GitHub Actions / Render cron: drains due sources, then exits.
import { pool } from "@/lib/database";
import { runPass } from "@/lib/ingestion/scheduler";
async function main() {
  const budget = Number(process.env.JOB_SYNC_BUDGET_MS) || 8 * 60_000;
  const t0 = Date.now();
  const total = { passes: 0, claimed: 0, success: 0, notModified: 0, partial: 0, failed: 0, jobsInserted: 0, jobsUpdated: 0, jobsClosed: 0, failures: {} as Record<string, number> };
  while (Date.now() - t0 < budget) {
    const s = await runPass({ budgetMs: budget - (Date.now() - t0) });
    if (!s.claimed) break;
    total.passes++;
    for (const k of ["claimed", "success", "notModified", "partial", "failed", "jobsInserted", "jobsUpdated", "jobsClosed"] as const) total[k] += s[k];
    for (const [k, v] of Object.entries(s.failures)) total.failures[k] = (total.failures[k] ?? 0) + v;
  }
  console.log(JSON.stringify({ ...total, durationMs: Date.now() - t0 }));
  await pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
