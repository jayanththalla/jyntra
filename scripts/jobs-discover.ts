// Incremental discovery. Examples:
//   npm run jobs:discover                                  validate the due part of the queue (daily limit applies)
//   npm run jobs:discover -- --registry path|url           import an open ATS registry (e.g. jobscraper_hourly companies.json) as candidates
//   npm run jobs:discover -- --leads file.csv --origin directory:t-hub    import company leads (name,website)
//   npm run jobs:discover -- --cdx                         Internet Archive CDX incremental discovery
import fs from "node:fs";
import { pool } from "@/lib/database";
import { discoverFromCdx } from "@/lib/ingestion/discovery/cdx";
import { importLeads, parseLeads } from "@/lib/ingestion/discovery/leads";
import { processQueue } from "@/lib/ingestion/discovery/pipeline";
import { importCandidates, parseRegistry } from "@/lib/ingestion/discovery/registry";
import { candidateCounts } from "@/lib/ingestion/discovery/candidates";
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] ?? "" : undefined; };
async function main() {
  const out: Record<string, unknown> = {};
  const reg = arg("registry");
  if (reg) {
    const raw = /^https?:/.test(reg) ? await (await fetch(reg)).json() : JSON.parse(fs.readFileSync(reg, "utf8"));
    const p = parseRegistry(raw, `registry:${arg("origin") ?? "import"}`);
    out.registry = { total: p.total, supportedCandidates: p.candidates.length, unsupportedByProvider: p.unsupported, invalid: p.invalid, ...(await importCandidates(p.candidates)) };
  }
  const leads = arg("leads");
  if (leads) out.leads = await importLeads(parseLeads(fs.readFileSync(leads, "utf8")), arg("origin") ?? "directory:import");
  if (process.argv.includes("--cdx")) out.cdx = await discoverFromCdx();
  if (!reg && !leads && !process.argv.includes("--cdx") || process.argv.includes("--process")) out.queue = await processQueue({ limit: Number(arg("limit")) || 25 });
  out.candidatesByState = await candidateCounts();
  console.log(JSON.stringify(out, null, 2));
  await pool().end();
}
main().catch((e) => { console.error(e); process.exit(1); });
