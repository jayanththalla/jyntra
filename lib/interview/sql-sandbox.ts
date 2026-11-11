// SQL execution for interview tests. SAFETY MODEL:
//  - Candidate SQL NEVER touches the application's PostgreSQL. It runs in sql.js (SQLite compiled to WebAssembly) in a throw-away
//    in-memory database, inside a worker thread that has no network or filesystem use and a memory cap.
//  - Only ONE statement is accepted and it must be SELECT or WITH ... SELECT (writes, DDL, PRAGMA, ATTACH are rejected before running).
//  - A hard wall-clock timeout terminates the worker thread; results are capped in rows and cell size.
//  - It is SQLite, not PostgreSQL. Results report `engine: "sqlite"` so the UI can say so. Standard SQL (joins, GROUP BY, CTEs,
//    window functions, subqueries) behaves the same; PostgreSQL-only syntax (e.g. DISTINCT ON, ::casts, ILIKE) does not run here.
import { Worker } from "node:worker_threads";
import path from "node:path";

export const SQL_LIMITS = { timeoutMs: 2500, maxRows: 200, maxCell: 200, maxSqlChars: 4000, maxSetupChars: 40_000, memoryMb: 96 } as const;

export class SqlRejected extends Error { constructor(public reason: string) { super(reason); this.name = "SqlRejected"; } }

export type SqlValue = string | number | null;
export type SqlRun =
  | { ok: true; engine: "sqlite"; columns: string[]; rows: SqlValue[][]; truncated: boolean; ms: number }
  | { ok: false; engine: "sqlite"; kind: "rejected" | "error" | "timeout"; message: string };

// Strips comments and string literals so keyword checks cannot be fooled by a keyword hidden inside a comment or a quoted string.
function skeleton(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""').replace(/\s+/g, " ").trim();
}
const FORBIDDEN = /\b(insert|update|delete|drop|create|alter|attach|detach|pragma|vacuum|reindex|replace\s+into|load_extension|begin|commit|rollback|savepoint|release|analyze|truncate|grant|revoke)\b/i;

/** Throws SqlRejected with a plain-English reason when the statement may not run. Returns the cleaned single statement. */
export function validateSelect(sql: string): string {
  if (typeof sql !== "string" || !sql.trim()) throw new SqlRejected("Write a query first.");
  if (sql.length > SQL_LIMITS.maxSqlChars) throw new SqlRejected(`The query is longer than ${SQL_LIMITS.maxSqlChars} characters.`);
  const s = skeleton(sql).replace(/;\s*$/, "");
  if (s.includes(";")) throw new SqlRejected("Only one statement can run at a time.");
  if (!/^(select|with)\b/i.test(s)) throw new SqlRejected("Only SELECT queries (optionally starting with WITH) can run.");
  const bad = s.match(FORBIDDEN);
  if (bad) throw new SqlRejected(`"${bad[0].toUpperCase()}" is not allowed. This tool only runs read-only SELECT queries.`);
  return sql.trim().replace(/;\s*$/, "");
}

// The worker source is a string so it works unchanged under Next.js bundling and tsx. It receives plain data only.
const WORKER_SRC = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  try {
    const init = require(workerData.sqljs);
    const SQL = await init({ locateFile: (f) => workerData.dist + "/" + f });
    const db = new SQL.Database();
    const t0 = Date.now();
    if (workerData.setup) db.exec(workerData.setup);
    const res = db.exec(workerData.sql);
    const first = res[0];
    const cap = (v) => (typeof v === "string" && v.length > workerData.maxCell ? v.slice(0, workerData.maxCell) : v instanceof Uint8Array ? "[binary]" : v);
    const all = first ? first.values : [];
    const rows = all.slice(0, workerData.maxRows).map((r) => r.map(cap));
    parentPort.postMessage({ ok: true, columns: first ? first.columns : [], rows, truncated: all.length > workerData.maxRows, ms: Date.now() - t0 });
    db.close();
  } catch (e) {
    parentPort.postMessage({ ok: false, message: String((e && e.message) || e).slice(0, 300) });
  }
})();
`;

// Plain path (no createRequire/require.resolve) so the bundler does not try to analyse it. next.config.ts lists these files for output tracing.
function sqljsPaths() {
  const dist = path.join(process.cwd(), "node_modules", "sql.js", "dist");
  return { sqljs: path.join(dist, "sql-wasm.js"), dist };
}

/**
 * Runs a validated SELECT against a fresh in-memory database prepared by `setup` (trusted SQL from our own problem definitions).
 * `setup` is never user input.
 */
export async function runSelect(sql: string, setup: string, over: Partial<Record<keyof typeof SQL_LIMITS, number>> = {}): Promise<SqlRun> {
  const L: Record<keyof typeof SQL_LIMITS, number> = { ...SQL_LIMITS, ...over };
  let cleaned: string;
  try { cleaned = validateSelect(sql); } catch (e) { return { ok: false, engine: "sqlite", kind: "rejected", message: (e as SqlRejected).reason ?? "Rejected." }; }
  if (setup.length > L.maxSetupChars) return { ok: false, engine: "sqlite", kind: "error", message: "Setup too large." };
  const { sqljs, dist } = sqljsPaths();
  return new Promise<SqlRun>((resolve) => {
    let settled = false;
    const worker = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { sqljs, dist, setup, sql: cleaned, maxRows: L.maxRows, maxCell: L.maxCell },
      resourceLimits: { maxOldGenerationSizeMb: L.memoryMb, maxYoungGenerationSizeMb: 16 },
      env: {},          // no environment (and so no secrets) inside the worker
      stdout: false, stderr: false,
    });
    const done = (r: SqlRun) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); resolve(r); };
    const timer = setTimeout(() => done({ ok: false, engine: "sqlite", kind: "timeout", message: `The query ran longer than ${L.timeoutMs / 1000}s and was stopped. Check for a missing join condition or an accidental cross join.` }), L.timeoutMs);
    worker.on("message", (m: any) => done(m.ok ? { ok: true, engine: "sqlite", columns: m.columns, rows: m.rows, truncated: m.truncated, ms: m.ms } : { ok: false, engine: "sqlite", kind: "error", message: m.message }));
    worker.on("error", (e) => done({ ok: false, engine: "sqlite", kind: /memory/i.test(String(e?.message)) ? "error" : "error", message: /memory|heap/i.test(String(e?.message)) ? "The query used too much memory and was stopped." : "The query could not be run." }));
    worker.on("exit", () => done({ ok: false, engine: "sqlite", kind: "error", message: "The query could not be run." }));
  });
}
