// npm run jobs:verify-urls [-- --limit 200 --city chennai]   Live check of employer application links (records only; never edits URLs or closes jobs).
import { pool } from "@/lib/database";
import { verifyApplyUrls } from "@/lib/ingestion/verify-urls";
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] ?? "" : undefined; };
verifyApplyUrls({ limit: Number(arg("limit")) || 200, city: arg("city") || null }).then(async (r) => { console.log(JSON.stringify(r)); await pool().end(); }).catch((e) => { console.error(e); process.exit(1); });
