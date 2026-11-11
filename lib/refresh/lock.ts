// Cross-process mutual exclusion using a PostgreSQL advisory lock, so two instances (or a cron call and a
// user click) can never run the same refresh at once. The in-memory flag in discovery/run.ts only protects
// one process; this protects the database.
import { pool, ready } from "@/lib/database";

export async function withAdvisoryLock<T>(name: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  await ready();
  const client = await pool().connect(); // a session lock lives on one connection, so keep it until unlock
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS ok", [`jyntra:${name}`]);
    if (!rows[0].ok) return { ran: false };
    try {
      return { ran: true, value: await fn() };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [`jyntra:${name}`]).catch(() => {});
    }
  } finally {
    client.release();
  }
}
