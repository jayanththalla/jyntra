import { pool, ready } from "@/lib/database";
ready().then(async () => { console.log("schema + ingestion migration applied (idempotent)"); await pool().end(); }).catch((e) => { console.error(e.message); process.exit(1); });
