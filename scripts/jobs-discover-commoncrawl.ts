// npm run jobs:discover-commoncrawl [-- --blocks 5]   One incremental Common Crawl step (cursor persisted in discovery_state).
import { pool } from "@/lib/database";
import { discoverFromCommonCrawl } from "@/lib/ingestion/discovery/commoncrawl";
const i = process.argv.indexOf("--blocks");
discoverFromCommonCrawl({ maxBlocks: i >= 0 ? Number(process.argv[i + 1]) || 5 : 5 }).then(async (r) => { console.log(JSON.stringify(r, null, 2)); await pool().end(); }).catch(async (e) => { console.error(e.message); await pool().end(); process.exit(1); });
