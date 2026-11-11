// Core-workflow integration tests on a REAL PostgreSQL (throw-away database).
// DATABASE_URL=postgres://… npm run test:workflow-db
import assert from "node:assert/strict";
import { Client } from "pg";

const base = process.env.DATABASE_URL;
if (!base) { console.log("SKIPPED: DATABASE_URL is not set, so no workflow database tests were run."); process.exit(0); }
process.env.KB_ENCRYPTION_KEY = "t".repeat(40);
process.env.CREDENTIAL_ENCRYPTION_KEY = "c".repeat(40);
process.env.GOOGLE_CLIENT_ID = "cid"; process.env.GOOGLE_CLIENT_SECRET = "csecret";
let passed = 0, failed = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 6).join("\n    ")}`); }
}

async function main() {
  const dbName = `jyntra_wf_${process.pid}_${Date.now() % 100000}`;
  const admin = new Client({ connectionString: base });
  await admin.connect(); admin.on("error", () => {});
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(base!); u.pathname = "/" + dbName; process.env.DATABASE_URL = u.toString();

  const { query, pool } = await import("@/lib/database");
  const users = await import("@/lib/users");
  const cstore = await import("@/lib/comms/store");
  const { sendDraft, previewDraft, logManualSend } = await import("@/lib/comms/send");
  const { seal } = await import("@/lib/secrets/vault");
  const { patchApplication } = await import("@/lib/applications/store");
  const { loadDashboard } = await import("@/lib/dashboard");
  const { loadStartups } = await import("@/lib/discovery/read");

  const mk = async (name: string) => (await users.createUser({ name, skills: ["Node.js", "Postgres"], target_roles: ["Backend"], tech_experience_years: 1, projects: [], preferred_locations: [], remote_preference: "any" } as any)).user;
  const A = await mk("A"), B = await mk("B");

  // shared data: one startup, three jobs (new+dated, undated first seen today, old dated)
  const [s] = await query("INSERT INTO startups (name, normalized_name, domain, source, source_url, last_funding_date, funding_round) VALUES ('Acme','acme','acme.test','funding_rss','https://acme.test/news', CURRENT_DATE - 5, 'Seed') RETURNING id");
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const ins = (title: string, url: string, posted: string | null, prec: string | null, ver: string | null, discoveredDaysAgo = 0) =>
    query(`INSERT INTO jobs (startup_id, job_title, job_url, posted_date, posted_precision, verification, source, source_url, discovered_at, last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,'company_careers',$3, now() - make_interval(days => $7), now()) RETURNING id`, [s.id, title, url, posted, prec, ver, discoveredDaysAgo]);
  const [jNew] = await ins("Backend Engineer", "https://acme.test/j/1", day(2), "exact", "ats_api");
  const [jUndated] = await ins("Backend Developer Intern", "https://acme.test/j/2", null, null, "ats_api");
  const [jOld] = await ins("Backend Engineer II", "https://acme.test/j/3", day(40), "exact", "ats_api", 40);

  console.log("posted-date rule on real rows");
  await t("old-but-still-listed roles are returned, with recency that never calls first-seen a posting date", async () => {
    const [st] = await loadStartups(A, { id: s.id });
    const by = new Map(st.jobs.map((j) => [j.id, j]));
    assert.equal(by.size, 3, "nothing is hidden by age any more");
    assert.equal(by.get(jNew.id)!.recency.bucket, "new");
    assert.equal(by.get(jUndated.id)!.recency.bucket, "newly_found");
    assert.equal(by.get(jUndated.id)!.recency.date_basis, "none");
    assert.equal(by.get(jOld.id)!.recency.bucket, "older");
    assert.equal(by.get(jNew.id)!.verification, "ats_api");
  });

  console.log("dashboard");
  await t("recommends only new/newly-found fitting jobs, excludes tracked ones, and metrics are per user", async () => {
    let d = await loadDashboard(A);
    const ids = d.picks.map((p) => p.job.id);
    assert.ok(ids.includes(jNew.id));
    assert.ok(!ids.includes(jOld.id), "older roles are not 'new' recommendations");
    await query("INSERT INTO applications (user_id, startup_id, job_id, status) VALUES ($1,$2,$3,'Saved')", [A.id, s.id, jNew.id]);
    d = await loadDashboard(A);
    assert.ok(!d.picks.some((p) => p.job.id === jNew.id), "a saved job leaves the recommendations");
    assert.equal(d.metrics.to_apply, 1);
    const dB = await loadDashboard(B);
    assert.equal(dB.metrics.to_apply, 0, "B sees nothing of A's pipeline");
    assert.ok(dB.picks.some((p) => p.job.id === jNew.id));
  });

  console.log("one draft/send service");
  const sentLog: any[] = [];
  const deps = { gmailSend: (async (o: any) => { sentLog.push(o); return { id: "gm1", threadId: "th1" }; }) as any, refresh: (async () => "tok") as any, sleep: async () => {} };
  await query("INSERT INTO email_accounts (user_id, provider, email, refresh_token_enc, status) VALUES ($1,'gmail_oauth','a@x.com',$2,'connected')", [A.id, seal("rt", "gmail-oauth", A.id)]);
  const draft = async (userId: number, extra: any = {}) => cstore.createDraft(userId, { kind: "cold_founder", to_email: "founder@acme.test", recipient_name: "F", cc: [], subject: "Hello", body: "Hi", application_id: null, startup_id: s.id, job_id: jUndated.id, ...extra });

  await t("sending needs confirmation + the previewed hash; success links the message to an application WITHOUT changing a status", async () => {
    const d = await draft(A.id);
    assert.equal((await sendDraft(A, d.id, { confirm: true, contentHash: "wrong" }, deps)).status, 409);
    assert.equal((await sendDraft(A, d.id, { confirm: false, contentHash: "x" }, deps)).status, 400);
    assert.equal(sentLog.length, 0);
    const pv: any = (await previewDraft(A, d.id)).body;
    const r = await sendDraft(A, d.id, { confirm: true, contentHash: pv.content_hash }, deps);
    assert.equal(r.status, 200); assert.equal(sentLog.length, 1);
    const after = await cstore.getDraft(A.id, d.id);
    assert.equal(after!.status, "sent");
    assert.ok(after!.application_id, "linked to an application");
    const [app] = await query("SELECT status FROM applications WHERE id = $1", [after!.application_id]);
    assert.equal(app.status, "Saved", "contacting a founder is not applying");
    // idempotent
    assert.equal(((await sendDraft(A, d.id, { confirm: true, contentHash: pv.content_hash }, deps)).body as any).duplicate, true);
    assert.equal(sentLog.length, 1);
  });
  await t("an existing Applied status is never touched by sending or logging", async () => {
    const [ap] = await query("INSERT INTO applications (user_id, startup_id, job_id, status, applied_at) VALUES ($1,$2,$3,'Interview', CURRENT_DATE) RETURNING id", [A.id, s.id, jOld.id]);
    const d = await draft(A.id, { job_id: jOld.id });
    const r = await logManualSend(A, d.id, { confirm: true });
    assert.equal(r.status, 200);
    assert.equal((await cstore.getDraft(A.id, d.id))!.application_id, ap.id);
    assert.equal((await query("SELECT status FROM applications WHERE id = $1", [ap.id]))[0].status, "Interview");
  });
  await t("manual log: explicit confirm only, honest wording, idempotent, not counted toward the send cap", async () => {
    const d = await draft(A.id, { kind: "linkedin_dm", to_email: null, subject: "", job_id: null });
    assert.equal((await logManualSend(A, d.id, { confirm: undefined })).status, 400);
    const r: any = await logManualSend(A, d.id, { confirm: true });
    assert.equal(r.body.sent, false); assert.equal(r.body.logged_by_user, true); assert.match(r.body.message, /did not send it/);
    const row = await cstore.getDraft(A.id, d.id);
    assert.equal(row!.via, "manual"); assert.equal(row!.provider_message_id, null); assert.equal(row!.from_email, null);
    assert.equal(((await logManualSend(A, d.id, { confirm: true })).body as any).duplicate, true);
    const [{ n }] = await query("SELECT count(*)::int AS n FROM email_drafts WHERE user_id = $1 AND status='sent' AND via <> 'manual'", [A.id]);
    assert.equal(n, 1, "only the real send counts toward the daily cap");
  });
  await t("another user cannot log, preview, send or edit your draft, and cannot link it to your application", async () => {
    const d = await draft(A.id);
    assert.equal((await logManualSend(B, d.id, { confirm: true })).status, 404);
    assert.equal((await previewDraft(B, d.id)).status, 404);
    await query("INSERT INTO email_accounts (user_id, provider, email, refresh_token_enc, status) VALUES ($1,'gmail_oauth','b@x.com',$2,'connected')", [B.id, seal("rtb", "gmail-oauth", B.id)]);
    const before = sentLog.length;
    assert.equal((await sendDraft(B, d.id, { confirm: true, contentHash: "x" }, deps)).status, 404);
    assert.equal(sentLog.length, before, "nothing was sent");
    assert.equal(await cstore.updateDraft(B.id, d.id, { kind: "cold_email", to_email: null, recipient_name: null, cc: [], subject: "x", body: "x", application_id: null, startup_id: null, job_id: null }), null);
    const [aApp] = await query("SELECT id FROM applications WHERE user_id = $1 LIMIT 1", [A.id]);
    const stolen = await draft(B.id, { application_id: aApp.id });
    assert.equal(stolen.application_id, null, "a foreign application id is dropped, not trusted");
    assert.equal((await cstore.getDraft(A.id, d.id))!.status, "draft");
  });

  console.log("user-recorded outcomes");
  await t("outcome is recorded only by the owner, moves the status only because the user chose it, and can be cleared", async () => {
    const [ap] = await query("UPDATE applications SET status = 'Applied', applied_at = CURRENT_DATE WHERE user_id = $1 AND startup_id = $2 AND job_id IS NULL RETURNING id", [A.id, s.id]);
    assert.equal((await patchApplication(B.id, ap.id, { outcome: "rejected" })).ok, false, "B cannot touch A's application");
    assert.equal((await query("SELECT outcome FROM applications WHERE id = $1", [ap.id]))[0].outcome, null);
    assert.equal((await patchApplication(A.id, ap.id, { outcome: "bogus" })).ok, false);
    const r: any = await patchApplication(A.id, ap.id, { outcome: "interview_scheduled", outcome_note: "Call Friday" });
    assert.equal(r.application.status, "Interview"); assert.equal(r.application.outcome, "interview_scheduled"); assert.ok(r.application.outcome_at);
    const w: any = await patchApplication(A.id, ap.id, { outcome: "no_response" });
    assert.equal(w.application.status, "Interview", "'no response' never changes the pipeline status by itself");
    const c: any = await patchApplication(A.id, ap.id, { outcome: null });
    assert.equal(c.application.outcome, null); assert.equal(c.application.outcome_at, null);
  });

  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
  await pool().end(); await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`); await admin.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
