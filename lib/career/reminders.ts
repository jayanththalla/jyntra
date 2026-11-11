// Pure helpers for reminders (no I/O) so they can be unit tested.

/** Accepts an ISO date-time string; rejects garbage and dates absurdly far away. */
export function parseDue(v: unknown): Date | null {
  if (typeof v !== "string" || v.length > 40) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y >= 2000 && y <= 2100 ? d : null;
}

/** Only real IANA zones are stored; anything else becomes UTC. */
export function validTimezone(v: unknown): string {
  if (typeof v !== "string" || !v || v.length > 64) return "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: v }); return v; } catch { return "UTC"; }
}

export type DueState = "done" | "overdue" | "today" | "upcoming";
export function dueState(due: string | Date, done: string | Date | null | undefined, now = new Date(), tz = "UTC"): DueState {
  if (done) return "done";
  const d = new Date(due);
  if (d.getTime() < now.getTime()) return "overdue";
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: validTimezone(tz) }).format(x);
  return day(d) === day(now) ? "today" : "upcoming";
}
