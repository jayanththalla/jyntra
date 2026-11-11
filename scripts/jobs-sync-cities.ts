// npm run jobs:sync-cities -- [--city bengaluru|hyderabad|chennai|india_remote|all] [--dry-run] [--provider X] [--limit N] [--concurrency N] [--only-known-city] [--verify-urls N] [--out file]
import fs from "node:fs";
import path from "node:path";
import { pool } from "@/lib/database";
import { CITY_FILTERS, syncCities, type CityFilter } from "@/lib/ingestion/sync-cities";
import { verifyApplyUrls } from "@/lib/ingestion/verify-urls";
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] ?? "" : undefined; };
async function main() {
  const city = (arg("city") ?? "all") as CityFilter;
  if (!CITY_FILTERS.includes(city)) throw new Error(`--city must be one of ${CITY_FILTERS.join(", ")}`);
  const dryRun = process.argv.includes("--dry-run");
  const rep = await syncCities({ city, dryRun, provider: arg("provider") || null, limit: Number(arg("limit")) || null, concurrency: Number(arg("concurrency")) || undefined, onlyKnownCity: process.argv.includes("--only-known-city") });
  let verify;
  const vn = Number(arg("verify-urls"));
  if (!dryRun && vn > 0) verify = await verifyApplyUrls({ limit: vn, city });
  const out = arg("out") ?? path.join("reports", `sync-cities-${city}-${rep.startedAt.replace(/[:.]/g, "-")}${dryRun ? "-dry" : ""}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ ...rep, applyUrlVerification: verify }, null, 2));
  console.log(`sources: ${rep.sources.loaded} loaded | ${rep.sources.succeeded} ok | ${rep.sources.incomplete} incomplete | ${rep.sources.failed} failed ${JSON.stringify(rep.sources.failures)}`);
  console.log(`jobs fetched ${rep.jobsFetched}${rep.db ? ` | db +${rep.db.inserted} ~${rep.db.updated} -${rep.db.closed} =${rep.db.unchanged}` : " (dry run: nothing written)"}`);
  for (const c of Object.keys(rep.perCity) as (keyof typeof rep.perCity)[]) {
    if (city !== "all" && c !== city) continue;
    const b = rep.perCity[c];
    console.log(`  ${c.padEnd(13)} companies ${String(b.companies).padStart(4)} | jobs ${String(b.jobs).padStart(5)} | missing apply URL ${b.missingApplyUrl}`);
    for (const s of b.sample.slice(0, 3)) console.log(`     · ${s.company}: ${s.title} [${s.locations.join(" / ")}] ${s.applyUrl ?? "(no apply URL)"}`);
  }
  if (verify) console.log(`apply-URL verification: ${verify.checked} checked ${JSON.stringify(verify.byStatus)}`);
  console.log(`report: ${out} (${(rep.durationMs / 1000).toFixed(1)} s)`);
  await pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
