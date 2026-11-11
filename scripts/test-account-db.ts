// Integration test for reminders, Google-account linking and the tracker SQL against a real PostgreSQL (or PGlite).
// Run: DATABASE_URL=postgres://… npx tsx scripts/test-account-db.ts
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL) { console.log("SKIPPED: DATABASE_URL is not set, so no database tests were run."); process.exit(0); }

async function main() {
  const { query, ready, pool, GENERIC_PROFILE } = await import("@/lib/database");
  const { userForGoogle } = await import("@/lib/auth/accounts");
  await ready();
  let ok = 0; const t = (n: string) => { ok++; console.log("  ✓", n); };
  const sub = "test-sub-" + Date.now();
  await query("DELETE FROM users WHERE google_sub LIKE 'test-sub-%'");

  // 1. brand new Google user -> created with an explorer profile
  const a = await userForGoogle({ sub, email: "a@example.com", name: "Asha" }, null);
  assert.equal(a.created, true);
  const [row] = await query<any>("SELECT email, google_sub, profile FROM users WHERE id = $1", [a.userId]);
  assert.equal(row.email, "a@example.com"); assert.equal(row.profile.explorer, true); assert.equal(row.profile.name, "Asha");
  t("a new Google sign-in creates a user with the verified email");

  // 2. same Google account again -> same user, no new row
  const a2 = await userForGoogle({ sub, email: "a@example.com", name: "Asha" }, null);
  assert.deepEqual([a2.userId, a2.created], [a.userId, false]);
  t("signing in again returns the same user");

  // 3. an anonymous user in this browser -> Google is LINKED to them (their data stays)
  const [anon] = await query<any>("INSERT INTO users (profile) VALUES ($1) RETURNING id, profile, pinned, link_created_at", [JSON.stringify(GENERIC_PROFILE)]);
  const sub2 = sub + "-b";
  const l = await userForGoogle({ sub: sub2, email: "b@example.com", name: "" }, { ...anon, email: null, google_linked: false });
  assert.deepEqual([l.userId, l.linked, l.created], [anon.id, true, false]);
  const [linked] = await query<any>("SELECT google_sub, email FROM users WHERE id = $1", [anon.id]);
  assert.deepEqual([linked.google_sub, linked.email], [sub2, "b@example.com"]);
  t("an existing anonymous user gets the Google account linked instead of losing their data");

  // 4. a different Google account while signed in as an already-linked user -> a separate user, never merged
  const x = await userForGoogle({ sub: sub + "-c", email: "c@example.com", name: "C" }, { ...anon, email: "b@example.com", google_linked: true });
  assert.notEqual(x.userId, anon.id); assert.equal(x.created, true);
  t("a second Google account is never merged into an already-linked user");

  // 5. reminders: owner scoping and the tracker query shape
  const [rem] = await query<any>("INSERT INTO career_reminders (user_id, title, due_at, timezone) VALUES ($1,'Follow up', now() - interval '1 day', 'Asia/Calcutta') RETURNING id", [a.userId]);
  const mine = await query("UPDATE career_reminders SET done_at = now() WHERE id = $1 AND user_id = $2 RETURNING id", [rem.id, a.userId]);
  const theirs = await query("UPDATE career_reminders SET done_at = now() WHERE id = $1 AND user_id = $2 RETURNING id", [rem.id, anon.id]);
  assert.equal(mine.length, 1); assert.equal(theirs.length, 0);
  const [cnt] = await query<any>(`SELECT count(*) FILTER (WHERE done_at IS NULL AND due_at < now())::int AS overdue, count(*) FILTER (WHERE done_at IS NOT NULL)::int AS done FROM career_reminders WHERE user_id = $1`, [a.userId]);
  assert.deepEqual([cnt.overdue, cnt.done], [0, 1]);
  t("reminders are owner-scoped and the tracker counts work");

  await query("DELETE FROM users WHERE google_sub LIKE 'test-sub-%' OR id = $1", [anon.id]);
  console.log(`${ok} account database checks passed`);
  await pool().end();
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
