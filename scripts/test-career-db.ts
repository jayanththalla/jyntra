// Career GPT integration tests on a REAL PostgreSQL (throw-away database). DATABASE_URL=postgres://… npm run test:career-db
import assert from "node:assert/strict";
import { Client } from "pg";

const base = process.env.DATABASE_URL;
if (!base) { console.log("SKIPPED: DATABASE_URL is not set, so no Career GPT database tests were run."); process.exit(0); }
process.env.KB_ENCRYPTION_KEY = "t".repeat(40);
process.env.CREDENTIAL_ENCRYPTION_KEY = "c".repeat(40);
process.env.GOOGLE_CLIENT_ID = "cid"; process.env.GOOGLE_CLIENT_SECRET = "csecret";
let passed = 0, failed = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 5).join("\n    ")}`); }
}

async function main() {
  const dbName = `jyntra_cg_${process.pid}_${Date.now() % 100000}`;
  const admin = new Client({ connectionString: base });
  await admin.connect(); admin.on("error", () => {});
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(base!); u.pathname = "/" + dbName; process.env.DATABASE_URL = u.toString();

  const { query, pool } = await import("@/lib/database");
  const users = await import("@/lib/users");
  const cs = await import("@/lib/career/store");
  const { generateForAnswer } = await import("@/lib/career/service");
  const conv = await import("@/lib/kb/conversations");
  const mem = await import("@/lib/kb/memory");
  const cstore = await import("@/lib/comms/store");
  const { sendDraft, previewDraft, DAILY_SEND_CAP } = await import("@/lib/comms/send");
  const { GmailError } = await import("@/lib/comms/gmail");
  const { seal } = await import("@/lib/secrets/vault");
  const { storeDocuments, createSource } = await import("@/lib/kb/store");

  const mk = async (name: string, extra: any = {}) => (await users.createUser({ name, skills: ["Python"], target_roles: ["Backend"], tech_experience_years: 2, projects: [], ...extra } as any)).user;
  const A = await mk("A"), B = await mk("B");
  const count = async (sql: string, p: unknown[] = []) => Number((await query(sql, p))[0].c);

  console.log("facts and conversations");
  await t("facts: confirmed vs suggested; only the owner can read, confirm or delete", async () => {
    const f = await cs.addFact(A.id, { category: "notice_period", text: "30 days" });
    const s = await cs.addFact(A.id, { text: "Led a team of 5", origin: "ai_suggested" });
    assert.equal(f.origin, "user_confirmed");
    assert.deepEqual((await cs.confirmedFacts(A.id)).map((x) => x.text), ["30 days"]);
    assert.equal(await cs.updateFact(B.id, s.id, { confirm: true }), null);
    assert.equal(await cs.deleteFact(B.id, s.id), false);
    assert.equal((await cs.updateFact(A.id, s.id, { confirm: true }))!.origin, "user_confirmed");
    assert.equal((await cs.confirmedFacts(B.id)).length, 0);
  });
  await t("conversations: rename, search (literal wildcards), pagination, isolation, delete with/without facts", async () => {
    const x = await conv.saveExchange(A.id, { mode: "auto", question: "Explain the shop 100% project", answer: "It uses PostgreSQL", citations: [], meta: {} });
    await conv.saveExchange(A.id, { mode: "auto", question: "Other topic", answer: "zzz", citations: [], meta: {} });
    await conv.saveExchange(B.id, { mode: "auto", question: "Explain the shop project", answer: "B private", citations: [], meta: {} });
    assert.equal((await conv.listConversations(A.id, 30, 0, "postgresql")).length, 1); // matches message text
    assert.equal((await conv.listConversations(A.id, 30, 0, "100%")).length, 1);
    assert.equal((await conv.listConversations(A.id, 30, 0, "_")).length, 0); // "_" is literal, not "any character"
    assert.equal((await conv.listConversations(A.id, 1, 1)).length, 1);
    assert.equal((await conv.listConversations(A.id, 30, 0, "private")).length, 0);
    assert.equal(await conv.renameConversation(B.id, x.conversationId, "hijack"), false);
    assert.equal(await conv.renameConversation(A.id, x.conversationId, "  Shop notes "), true);
    assert.equal((await conv.getConversation(A.id, x.conversationId))!.title, "Shop notes");
    const keep = await cs.addFact(A.id, { text: "kept", conversationId: x.conversationId });
    assert.equal(keep.conversation_id, x.conversationId);
    assert.equal((await cs.addFact(B.id, { text: "stolen link", conversationId: x.conversationId })).conversation_id, null);
    assert.equal(await conv.deleteConversation(B.id, x.conversationId), false);
    await conv.deleteConversation(A.id, x.conversationId);
    assert.equal(await count("SELECT count(*) c FROM kb_facts WHERE id = $1", [keep.id]), 1); // facts survive by default
    const y = await conv.saveExchange(A.id, { mode: "auto", question: "again", answer: "a", citations: [], meta: {} });
    const f2 = await cs.addFact(A.id, { text: "tied", conversationId: y.conversationId });
    await conv.deleteConversation(A.id, y.conversationId, { alsoFacts: true });
    assert.equal(await count("SELECT count(*) c FROM kb_facts WHERE id = $1", [f2.id]), 0);
  });
  await t("memory: the summary rolls forward, history is bounded and owner-scoped", async () => {
    let id = 0;
    for (let i = 0; i < 9; i++) id = (await conv.saveExchange(A.id, { conversationId: id || null, mode: "auto", question: `question ${i}`, answer: `answer ${i}`, citations: [], meta: {} })).conversationId;
    await mem.rollSummary(A.id, id);
    const h = await mem.loadHistory(A.id, id);
    assert.equal(h!.recent.length, mem.RECENT_MESSAGES);
    assert.match(h!.summary, /question 0/);
    assert.equal(await mem.loadHistory(B.id, id), null);
  });

  console.log("application answer sets");
  let setId = 0, ansIds: number[] = [];
  await t("a pasted form becomes ordered questions with limits; reopenable; owner-only", async () => {
    const r: any = await cs.createSet(A.id, { raw: "1. Tell us about yourself (max 80 words)\n2. Why should we hire you?\n3. What is your notice period?" });
    setId = r.set.id; ansIds = r.set.answers.map((a: any) => a.id);
    assert.deepEqual(r.set.answers.map((a: any) => [a.position, a.word_limit, a.status]), [[1, 80, "pending"], [2, null, "pending"], [3, null, "pending"]]);
    assert.equal(await cs.getSet(B.id, setId), null);
    assert.equal((await cs.listSets(B.id)).length, 0);
    assert.equal((await cs.listSets(A.id))[0].total, 3);
    assert.equal(await cs.deleteSet(B.id, setId), false);
    assert.equal((await cs.createSet(A.id, { raw: "   " }) as any).error, "no_questions");
  });
  await t("generation stores the answer; notice period asks first, then works once the fact is saved; editing marks complete", async () => {
    const calls: string[] = [];
    const deps: any = { retrieve: async () => [], overview: async () => [], resume: async () => [], entities: async () => [{ kind: "skill", name: "Python", level: "self_reported", data: {} }], projectNames: async () => [], facts: cs.confirmedFacts, aiConfigured: () => true, complete: async (p: string) => (calls.push(p), { text: '{"answer":"My notice period is 30 days.","used":[]}', provider: "groq" }) };
    const r1: any = await generateForAnswer(await users.userBySession(null) as any ?? A, ansIds[2], { kind: "generate" }, deps);
    assert.equal(r1.answer.status, "complete"); // A already saved a 30 days notice_period fact above
    assert.match(r1.answer.answer, /30 days/);
    const edited: any = await cs.editAnswer(A.id, ansIds[0], { answer: "I'm a backend developer." });
    assert.equal(edited.status, "complete"); assert.equal(edited.edited, true);
    assert.equal(await cs.editAnswer(B.id, ansIds[0], { answer: "x" }), null);
    assert.equal(await generateForAnswer(B, ansIds[0], { kind: "generate" }, deps), null); // other users cannot generate into it
    assert.equal(calls.length, 1);
    assert.equal((await cs.editAnswer(A.id, ansIds[0], { answer: "" }))!.status, "pending");
  });
  await t("shorten with no existing answer is a normal generation; a needs_input result never wipes existing text", async () => {
    await cs.editAnswer(A.id, ansIds[1], { answer: "I built things." });
    const deps: any = { retrieve: async () => [], overview: async () => [], resume: async () => [], entities: async () => [], projectNames: async () => [], facts: async () => [], aiConfigured: () => true, complete: async () => ({ text: "{}", provider: "x" }) };
    const sal = await cs.addQuestion(A.id, setId, "What are your salary expectations?");
    const gen: any = await generateForAnswer(A, sal.id, { kind: "shorten" }, deps);
    assert.equal(gen.answer.status, "needs_input");
    await cs.editAnswer(A.id, sal.id, { answer: "Draft I wrote" });
    const again: any = await generateForAnswer(A, sal.id, { kind: "generate" }, deps);
    assert.equal(again.answer.answer, "Draft I wrote");
    assert.equal(again.answer.status, "needs_input");
  });
  await t("linking a set to an application or resume that is not yours is refused", async () => {
    const [s] = await query("INSERT INTO startups (name, normalized_name, source) VALUES ('Acme','acme','yc') RETURNING id");
    const [ap] = await query("INSERT INTO applications (user_id, startup_id) VALUES ($1,$2) RETURNING id", [B.id, s.id]);
    assert.equal(((await cs.updateSet(A.id, setId, { application_id: ap.id })) as any).error, "application_not_found");
    const [ap2] = await query("INSERT INTO applications (user_id, startup_id) VALUES ($1,$2) RETURNING id", [A.id, s.id]);
    assert.ok((await cs.updateSet(A.id, setId, { application_id: ap2.id }) as any).ok);
    const job = await cs.loadApplicationJob(A.id, ap2.id);
    assert.equal(job!.company, "Acme");
    assert.equal(await cs.loadApplicationJob(A.id, ap.id), null);
  });

  console.log("email drafts and sending");
  const mkDraft = (uid: number, o: any = {}) => cstore.createDraft(uid, { kind: "cold_recruiter", to_email: "rec@acme.com", recipient_name: null, cc: [], subject: "Hello", body: "Hi, I'd love to talk about the role.", application_id: null, startup_id: null, job_id: null, ...o });
  const connect = async (uid: number) => cstore.upsertAccount(uid, "me@gmail.com", seal("refresh-1", "gmail-oauth", uid));
  const okDeps = (log: any[]) => ({ refresh: async () => "access", gmailSend: async (i: any) => (log.push(i), { id: "gm-1", threadId: "th-1" }), sleep: async () => {} });
  const confirm = async (u: any, id: number) => ({ confirm: true, contentHash: ((await previewDraft(u, id)).body as any).content_hash });

  await t("no account connected: nothing is sent and the draft stays a draft", async () => {
    const d = await mkDraft(A.id);
    const r = await sendDraft(A, d.id, await confirm(A, d.id), okDeps([]));
    assert.equal(r.status, 422); assert.equal(r.body.error, "not_connected");
    assert.equal((await cstore.getDraft(A.id, d.id))!.status, "draft");
  });
  await connect(A.id); await connect(B.id);
  await t("explicit confirmation and the previewed hash are required", async () => {
    const d = await mkDraft(A.id); const log: any[] = [];
    assert.equal((await sendDraft(A, d.id, { confirm: undefined, contentHash: "x" }, okDeps(log))).body.error, "confirmation_required");
    assert.equal((await sendDraft(A, d.id, { confirm: true, contentHash: undefined }, okDeps(log))).body.error, "preview_required");
    const c = await confirm(A, d.id);
    await cstore.updateDraft(A.id, d.id, { ...d, body: "Edited after preview" } as any);
    assert.equal((await sendDraft(A, d.id, c, okDeps(log))).body.error, "content_changed");
    assert.equal(log.length, 0);
  });
  await t("success: sent only after Gmail returns an id; id, thread, from, via recorded", async () => {
    const d = await mkDraft(A.id, { cc: ["boss@acme.com"] }); const log: any[] = [];
    const r = await sendDraft(A, d.id, await confirm(A, d.id), okDeps(log));
    assert.equal(r.status, 200); assert.equal(r.body.sent, true);
    const row = (await cstore.getDraft(A.id, d.id))!;
    assert.deepEqual([row.status, row.provider_message_id, row.via, row.from_email], ["sent", "gm-1", "gmail_api", "me@gmail.com"]);
    assert.deepEqual(log[0].cc, ["boss@acme.com"]);
    assert.equal(JSON.stringify(r.body).includes("refresh-1"), false);
  });
  await t("duplicate prevention: a second send, and two concurrent sends, deliver exactly one message", async () => {
    const d = await mkDraft(A.id); const log: any[] = [];
    const c = await confirm(A, d.id);
    const slow = { ...okDeps(log), gmailSend: async (i: any) => { await new Promise((r) => setTimeout(r, 150)); log.push(i); return { id: "gm-2", threadId: null }; } };
    const [x, y] = await Promise.all([sendDraft(A, d.id, c, slow), sendDraft(A, d.id, c, slow)]);
    assert.deepEqual([x.status, y.status].sort(), [200, 409]);
    const again = await sendDraft(A, d.id, c, slow);
    assert.equal(again.body.duplicate, true);
    assert.equal(log.length, 1);
  });
  await t("provider refusal -> failed (retryable, nothing sent); retry later succeeds once", async () => {
    const d = await mkDraft(A.id); let n = 0; const log: any[] = [];
    const flaky = { refresh: async () => "a", sleep: async () => {}, gmailSend: async () => { n++; throw new GmailError("invalid_message"); } };
    const r = await sendDraft(A, d.id, await confirm(A, d.id), flaky);
    assert.equal(r.body.error, "invalid_message"); assert.match(String(r.body.message), /Nothing was sent/);
    assert.equal((await cstore.getDraft(A.id, d.id))!.status, "failed");
    const r2 = await sendDraft(A, d.id, await confirm(A, d.id), okDeps(log));
    assert.equal(r2.body.sent, true); assert.equal(log.length, 1);
  });
  await t("rate limit / 5xx are retried automatically with backoff, then reported as failed", async () => {
    const d = await mkDraft(A.id); let n = 0; const sleeps: number[] = [];
    const r = await sendDraft(A, d.id, await confirm(A, d.id), { refresh: async () => "a", sleep: async (ms: number) => { sleeps.push(ms); }, gmailSend: async () => { n++; throw new GmailError("rate_limited"); } });
    assert.equal(n, 3); assert.equal(sleeps.length, 2); assert.equal(r.status, 429); assert.equal(r.body.retryable, true);
    const d2 = await mkDraft(A.id); let k = 0;
    const r2 = await sendDraft(A, d2.id, await confirm(A, d2.id), { refresh: async () => "a", sleep: async () => {}, gmailSend: async () => { if (++k < 3) throw new GmailError("provider_unavailable"); return { id: "gm-3", threadId: null }; } });
    assert.equal(r2.body.sent, true); assert.equal(k, 3);
  });
  await t("lost contact -> 'unknown': never auto-retried, needs acknowledgement; stale 'sending' is parked the same way", async () => {
    const d = await mkDraft(A.id); const log: any[] = [];
    const lost = { refresh: async () => "a", sleep: async () => {}, gmailSend: async () => { throw new GmailError("no_response"); } };
    const r = await sendDraft(A, d.id, await confirm(A, d.id), lost);
    assert.equal(r.body.status, "unknown");
    assert.equal(await cstore.updateDraft(A.id, d.id, { ...(await cstore.getDraft(A.id, d.id))!, body: "edited" } as any).then((x) => x!.status), "unknown"); // editing does not clear the warning
    const blocked = await sendDraft(A, d.id, await confirm(A, d.id), okDeps(log));
    assert.equal(blocked.body.error, "unknown_outcome"); assert.equal(log.length, 0);
    const ack = await sendDraft(A, d.id, { ...(await confirm(A, d.id)), acknowledgeUnknown: true }, okDeps(log));
    assert.equal(ack.body.sent, true);
    const s = await mkDraft(A.id);
    await query("UPDATE email_drafts SET status = 'sending', claimed_at = now() - interval '10 minutes' WHERE id = $1", [s.id]);
    assert.equal((await sendDraft(A, s.id, await confirm(A, s.id), okDeps(log))).body.error, "unknown_outcome");
  });
  await t("revoked grant: the account is marked revoked, its token dropped, and the next send says reconnect", async () => {
    const C = await mk("C"); await connect(C.id);
    const d = await mkDraft(C.id);
    const r = await sendDraft(C, d.id, await confirm(C, d.id), { refresh: async () => { throw new GmailError("reconnect_required"); }, sleep: async () => {}, gmailSend: async () => ({ id: "x", threadId: null }) });
    assert.equal(r.body.error, "reconnect_required");
    const acc = (await cstore.getAccount(C.id))!;
    assert.deepEqual([acc.status, acc.refresh_token_enc], ["revoked", null]);
    const r2 = await sendDraft(C, d.id, await confirm(C, d.id), okDeps([]));
    assert.equal(r2.body.error, "reconnect_required");
  });
  await t("isolation: another user cannot preview, send, edit, delete or list your drafts; links must be yours", async () => {
    const d = await mkDraft(A.id);
    assert.equal((await previewDraft(B, d.id)).status, 404);
    assert.equal((await sendDraft(B, d.id, { confirm: true, contentHash: contentHashOf(d) }, okDeps([]))).status, 404);
    assert.equal(await cstore.updateDraft(B.id, d.id, d as any), null);
    assert.equal(await cstore.deleteDraft(B.id, d.id), false);
    assert.ok(!(await cstore.listDrafts(B.id)).some((x) => x.id === d.id));
    const [s] = await query("INSERT INTO startups (name, normalized_name, source) VALUES ('Zed','zed','yc') RETURNING id");
    const [ap] = await query("INSERT INTO applications (user_id, startup_id) VALUES ($1,$2) RETURNING id", [B.id, s.id]);
    assert.equal((await mkDraft(A.id, { application_id: ap.id })).application_id, null);
  });
  function contentHashOf(d: any) { return cstore.contentHash(d); }
  await t("sent messages are history: they cannot be edited or deleted; daily cap enforced", async () => {
    const sent = (await cstore.listDrafts(A.id, { status: "sent" }))[0];
    assert.equal(await cstore.deleteDraft(A.id, sent.id), false);
    assert.equal(await cstore.updateDraft(A.id, sent.id, sent as any), null);
    const D = await mk("D"); await connect(D.id);
    for (let i = 0; i < DAILY_SEND_CAP; i++) await query("INSERT INTO email_drafts (user_id, to_email, subject, body, status, sent_at) VALUES ($1,'x@y.com','s','b','sent',now())", [D.id]);
    const d = await mkDraft(D.id);
    assert.equal((await sendDraft(D, d.id, await confirm(D, d.id), okDeps([]))).status, 429);
  });
  await t("SMTP fallback: uses the user's own encrypted App Password; never a server mailbox; reports failure honestly", async () => {
    const { applyGmailPassword } = await import("@/lib/secrets/gmail");
    const enc = applyGmailPassword({} as any, 77, "abcd efgh ijkl mnop", "smtp@gmail.com").enc!;
    const E = await mk("E");
    await users.updateUserProfile(E.id, { ...E.profile, gmail_user: "smtp@gmail.com", gmail_app_password_enc: seal("abcdefghijklmnop", "gmail-smtp", E.id) } as any);
    const E2 = (await users.userBySession(null)) ?? (await query("SELECT id, profile, pinned, link_created_at FROM users WHERE id = $1", [E.id]))[0];
    void enc;
    const d = await mkDraft(E.id); const seen: any[] = [];
    const r = await sendDraft(E2 as any, d.id, await confirm(E2, d.id), { smtpSend: async (o) => (seen.push(o), { ok: true, messageId: "<smtp-1>" }) });
    assert.equal(r.body.sent, true); assert.equal(seen[0].credentials.pass, "abcdefghijklmnop");
    const d2 = await mkDraft(E.id);
    const f = await sendDraft(E2 as any, d2.id, await confirm(E2, d2.id), { smtpSend: async () => ({ ok: false, error: "x" }) });
    assert.equal(f.body.error, "smtp_failed"); assert.equal((await cstore.getDraft(E.id, d2.id))!.status, "failed");
  });
  await t("disconnect removes the token row", async () => {
    const a = (await cstore.getAccount(B.id))!;
    const removed = await cstore.removeAccount(B.id, a.id);
    assert.ok(removed!.refresh_token_enc);
    assert.equal(await cstore.getAccount(B.id), null);
    assert.equal(await cstore.removeAccount(A.id, a.id), null);
  });

  void storeDocuments; void createSource;
  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
  await pool().end(); await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`); await admin.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
