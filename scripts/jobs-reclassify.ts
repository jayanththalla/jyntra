// npm run jobs:reclassify [-- --dry-run]   Recompute city classification of stored jobs from their own locations (no network).
import { pool } from "@/lib/database";
import { reclassifyJobs } from "@/lib/ingestion/reclassify";
reclassifyJobs({ dryRun: process.argv.includes("--dry-run") }).then(async (r) => { console.log(JSON.stringify(r, null, 2)); await pool().end(); }).catch((e) => { console.error(e); process.exit(1); });
