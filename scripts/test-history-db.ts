// Historical import integration tests on a REAL PostgreSQL (throw-away database). DATABASE_URL=postgres://… npm run test:history-db
import assert from "node:assert/strict";
import fs from "node:fs";
import { Client } from "pg";

const base = process.env.DATABASE_URL;
if (!base) { console.log("SKIPPED: DATABASE_URL is not set, so no history import database tests were run."); process.exit(0); }
let passed = 0, failed = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 5).join("\n    ")}`); }
}

async function main() {
  const dbName = `jyntra_hist_${process.pid}_${Date.now() % 100000}`;
  const admin = new Client({ connectionString: base });
  await admin.connect(); admin.on("error", () => {});
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(base!); u.pathname = "/" + dbName; process.env.DATABASE_URL = u.toString();

  const { query, pool } = await import("@/lib/database");
  pool().on("error", () => {}); // DROP DATABASE ... FORCE at the end kills pooled connections
  const users = await import("@/lib/users");
  const h = await import("@/lib/applications/history");
  const hs = await import("@/lib/applications/history-store");
  const { loadActivity } = await import("@/lib/kb/activity");

  const mk = async (name: string) => (await users.createUser({ name, skills: ["Python"], target_roles: ["Backend"], tech_experience_years: 2, projects: [] } as any)).user;
  const A = await mk("A"), B = await mk("B");
  const n = async (sql: string, p: unknown[] = []) => Number((await query(sql, p))[0].c);

  console.log("migration");
  await t("schema is idempotent (applied again on a populated database)", async () => {
    await pool().query(fs.readFileSync("lib/database/schema.sql", "utf8"));
  });

  console.log("staging");
  await t("staging the seed creates NO applications", async () => {
    const r = await hs.stage(A.id, h.HISTORICAL_SEED, "historical_seed");
    assert.equal(r.staged.length, 17);
    assert.equal(await n("SELECT count(*) c FROM applications WHERE user_id = $1", [A.id]), 0);
  });
  await t("staging again does not duplicate pending records", async () => {
    const r = await hs.stage(A.id, h.HISTORICAL_SEED);
    assert.equal(r.staged.length, 0); assert.equal(r.alreadyPending.length, 17);
    assert.equal(await n("SELECT count(*) c FROM application_import_candidates WHERE user_id = $1", [A.id]), 17);
  });
  await t("editing recomputes dedupe and refuses a clash with another pending record", async () => {
    const list = await hs.listCandidates(A.id, "pending");
    const tvh = list.find((c: any) => c.company === "TVH"), kan = list.find((c: any) => c.company === "Kanerika");
    assert.equal(await hs.editCandidate(A.id, tvh.id, { company: "Kanerika", role: "Software Engineer" }), "clash");
    const ok: any = await hs.editCandidate(A.id, kan.id, { contact: "talent.acquisition@kanerika.com" });
    assert.equal(ok.contact_email, "talent.acquisition@kanerika.com");
    assert.equal(await hs.editCandidate(A.id, kan.id, { company: "   " }), "invalid");
  });

  console.log("confirm");
  let chargebeeApp = 0;
  await t("confirm creates 'To Verify' / unknown / unverified rows, never Applied; missing contact stays NULL", async () => {
    const list = await hs.listCandidates(A.id, "pending");
    const pick = list.filter((c: any) => ["Chargebee", "Cardboard", "Sakana AI"].includes(c.company));
    const res = await hs.confirm(A.id, pick.map((c: any) => ({ id: c.id, action: "create" as const })));
    assert.deepEqual(res.map((r) => r.outcome), ["created", "created", "created"]);
    const rows = await query("SELECT company_name, status, status_certainty, verification_state, record_source, contact_email, applied_at, startup_id FROM applications WHERE user_id = $1 ORDER BY company_name", [A.id]);
    assert.equal(rows.length, 3);
    for (const r of rows) { assert.equal(r.status, "To Verify"); assert.equal(r.status_certainty, "unknown"); assert.equal(r.verification_state, "unverified"); assert.equal(r.applied_at, null); assert.equal(r.startup_id, null); assert.equal(r.record_source, "historical_summary"); }
    assert.equal(rows.find((r: any) => r.company_name === "Cardboard").contact_email, null);
    assert.equal(rows.find((r: any) => r.company_name === "Chargebee").contact_email, "chris.dias@chargebee.com");
    chargebeeApp = (await query("SELECT id FROM applications WHERE company_name = 'Chargebee' AND user_id = $1", [A.id]))[0].id;
  });
  await t("confirming the same candidate twice creates one application", async () => {
    const c = (await hs.listCandidates(A.id, "confirmed"))[0];
    assert.equal((await hs.confirm(A.id, [{ id: c.id, action: "create" }]))[0].outcome, "not_found");
    assert.equal(await n("SELECT count(*) c FROM applications WHERE user_id = $1", [A.id]), 3);
  });
  await t("re-importing a record that is now an application is flagged duplicate and is not created without a decision", async () => {
    const r = await hs.stage(A.id, [{ company: "Chargebee", role: "Software Development Engineer Intern" }]);
    assert.equal(r.staged[0].match_kind, "duplicate"); assert.equal(r.staged[0].match_application_id, chargebeeApp);
    assert.equal((await hs.confirm(A.id, [{ id: r.staged[0].id, action: "create" }]))[0].outcome, "needs_decision");
    assert.equal(await n("SELECT count(*) c FROM applications WHERE user_id = $1", [A.id]), 3);
  });
  await t("a different role at the same company is 'possible_duplicate'; 'create anyway' makes a distinct application", async () => {
    const r = await hs.stage(A.id, [{ company: "Chargebee", role: "Product Manager" }]);
    assert.equal(r.staged[0].match_kind, "possible_duplicate");
    assert.equal((await hs.confirm(A.id, [{ id: r.staged[0].id, action: "create", createAnyway: true }]))[0].outcome, "created");
    assert.equal(await n("SELECT count(*) c FROM applications WHERE user_id = $1 AND company_name = 'Chargebee'", [A.id]), 2);
  });
  await t("merge fills empty fields only and leaves the status alone", async () => {
    await query("UPDATE applications SET contact_email = NULL, status = 'Interview', status_certainty = 'confirmed' WHERE id = $1", [chargebeeApp]);
    const dup = (await hs.listCandidates(A.id, "pending")).find((c: any) => c.company === "Chargebee" && c.match_kind === "duplicate");
    const r = await hs.confirm(A.id, [{ id: dup.id, action: "merge" }]);
    assert.equal(r[0].outcome, "merged");
    const [a] = await query("SELECT status, contact_email, status_certainty FROM applications WHERE id = $1", [chargebeeApp]);
    assert.equal(a.status, "Interview"); assert.equal(a.status_certainty, "confirmed"); assert.equal(a.contact_email, null); // candidate had no contact; nothing invented
  });
  await t("skipped candidates are never created", async () => {
    const c = (await hs.listCandidates(A.id, "pending")).find((x: any) => x.company === "PALMONAS");
    assert.equal(await hs.skipCandidate(A.id, c.id), true);
    assert.equal(await hs.skipCandidate(A.id, c.id), false);
    assert.equal(await n("SELECT count(*) c FROM applications WHERE user_id = $1 AND company_name = 'PALMONAS'", [A.id]), 0);
  });

  console.log("isolation and integration");
  await t("user B cannot read, edit, skip, confirm or merge into A's records", async () => {
    const aPending = (await hs.listCandidates(A.id, "pending"))[0];
    assert.equal((await hs.listCandidates(B.id)).length, 0);
    assert.equal(await hs.editCandidate(B.id, aPending.id, { company: "X" }), null);
    assert.equal(await hs.skipCandidate(B.id, aPending.id), false);
    assert.equal((await hs.confirm(B.id, [{ id: aPending.id, action: "create" }]))[0].outcome, "not_found");
    const bc = (await hs.stage(B.id, [{ company: "Z Corp", role: "Dev" }])).staged[0];
    assert.equal((await hs.confirm(B.id, [{ id: bc.id, action: "merge", mergeInto: chargebeeApp }]))[0].outcome, "not_found");
    assert.equal(await n("SELECT count(*) c FROM applications WHERE user_id = $1", [B.id]), 0);
  });
  await t("the same company imported by two users does not collide", async () => {
    const r = await hs.stage(B.id, [{ company: "Chargebee", role: "SDE Intern" }]);
    assert.equal(r.staged[0].match_kind, "new");
    assert.equal((await hs.confirm(B.id, [{ id: r.staged[0].id, action: "create" }]))[0].outcome, "created");
  });
  await t("imported rows appear in the tracker query and activity summary as 'To Verify'", async () => {
    const rows = await query(`SELECT COALESCE(s.name, a.company_name) AS startup_name, COALESCE(a.role_title, j.job_title) AS job_title, a.status FROM applications a LEFT JOIN startups s ON s.id = a.startup_id LEFT JOIN jobs j ON j.id = a.job_id WHERE a.user_id = $1`, [A.id]);
    assert.ok(rows.some((r: any) => r.startup_name === "Cardboard" && r.status === "To Verify"));
    const act = await loadActivity(A.id);
    assert.ok(act.apps.some((a) => a.company === "Cardboard" && a.status === "To Verify"));
    assert.equal(act.apps.filter((a) => a.status === "Applied").length, 0);
  });
  await t("audit trail records import actions without contact details", async () => {
    assert.ok(await n("SELECT count(*) c FROM application_audit WHERE user_id = $1", [A.id]) >= 5);
    assert.equal(await n("SELECT count(*) c FROM application_audit WHERE detail LIKE '%@%'"), 0);
  });
  await t("deleting a user removes candidates, applications and audit rows", async () => {
    await query("DELETE FROM users WHERE id = $1", [B.id]);
    for (const tbl of ["application_import_candidates", "applications", "application_audit"]) assert.equal(await n(`SELECT count(*) c FROM ${tbl} WHERE user_id = $1`, [B.id]), 0);
  });

  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
  await pool().end(); await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`); await admin.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
