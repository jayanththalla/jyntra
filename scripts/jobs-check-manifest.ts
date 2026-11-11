// npm run jobs:check-manifest   Reads the supplemental dataset manifest and records its real counts. Does not download job data.
import { pool } from "@/lib/database";
import { checkSupplementalManifest } from "@/lib/ingestion/supplemental/manifest";
checkSupplementalManifest().then(async (r) => { console.log(JSON.stringify(r, null, 2)); await pool().end(); }).catch(async (e) => { console.error("manifest check failed:", e.message); await pool().end(); process.exit(1); });
