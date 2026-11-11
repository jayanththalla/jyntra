// npm run jobs:discover-seed -- [--limit N] [--provider greenhouse] [--offset N] [--dry-run] [--no-validate] [--concurrency N] [--out file.json]
//
// 1. enumerate the ATS company inventories (kalil0321/ats-scrapers `ats-companies/`)  2. download + parse + normalise + dedupe
// 3. import as CANDIDATES (idempotent)  4. validate against the REAL provider endpoints (bounded)  5. register India-relevant boards
// as job sources  6. write a detailed report.  `--dry-run` writes nothing to the database (validation is read-only network).
import fs from "node:fs";
import path from "node:path";
import { pool } from "@/lib/database";
import { runDiscoverSeed } from "@/lib/ingestion/discovery/seed";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] ?? "" : undefined; };
const flag = (n: string) => process.argv.includes(`--${n}`);
const int = (n: string) => { const v = arg(n); if (v === undefined) return undefined; const x = Number(v); if (!Number.isInteger(x) || x < 0) throw new Error(`--${n} must be a non-negative integer`); return x; };

async function main() {
  const dryRun = flag("dry-run");
  const report = await runDiscoverSeed({ limit: int("limit") || null, offset: int("offset"), provider: arg("provider") || null, dryRun, validate: !flag("no-validate"), concurrency: int("concurrency") });
  const out = arg("out") ?? path.join("reports", `discover-seed-${report.startedAt.replace(/[:.]/g, "-")}${dryRun ? "-dry" : ""}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  const i = report.inventory, v = report.validation;
  console.log(`\nATS inventory (${i.via}): ${i.filesListed} files listed, ${i.filesDownloaded} downloaded, ${i.rowsRead} rows read`);
  console.log(`  candidates parsed ${i.candidatesParsed} | invalid ${i.invalidRows} | duplicates removed ${i.duplicatesRemoved} | unsupported-provider rows ${i.unsupportedRows} (${Object.keys(i.unsupportedByProvider).length} platforms)`);
  console.log(`  selected ${i.selected}${dryRun ? " (dry run: nothing written)" : ` | newly inserted ${i.inserted} | already known ${i.alreadyKnown}`}`);
  for (const n of i.notes) console.log(`  note: ${n}`);
  if (v) {
    console.log(`\nValidation against real endpoints: ${v.checked} boards checked`);
    for (const [k, n] of Object.entries(v.byStatus)) console.log(`  ${k.padEnd(26)} ${n}`);
    console.log(`  India-relevant boards ${v.indiaRelevantBoards} | boards with Bengaluru/Hyderabad/Chennai jobs ${v.boardsWithTrackedCityJobs} | jobs seen ${v.jobsSeen}`);
    if (report.networkNote) console.log(`\n⚠ ${report.networkNote}`);
  }
  console.log(`\nHTTP: ${report.http.requests} requests, ${(report.http.bytes / 1024).toFixed(0)} KiB, ${JSON.stringify(report.http.byStatus)} | duration ${(report.durationMs / 1000).toFixed(1)} s`);
  console.log(`Report written to ${out}`);
  if (!dryRun) await pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
