// npm run jobs:report [-- --json]   Prints the discovery + ingestion report computed from the database.
import { pool } from "@/lib/database";
import { buildIngestionReport, formatReport } from "@/lib/ingestion/report";
buildIngestionReport().then(async (r) => { console.log(process.argv.includes("--json") ? JSON.stringify(r, null, 2) : formatReport(r)); await pool().end(); }).catch((e) => { console.error(e); process.exit(1); });
