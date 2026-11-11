// Knowledge-base integration tests on a REAL PostgreSQL (throw-away database). DATABASE_URL=postgres://… npm run test:kb-db
import assert from "node:assert/strict";
import { Client } from "pg";
import { fakeFetch, githubRoutes } from "./kb-fixtures";

const base = process.env.DATABASE_URL;
if (!base) {
  console.log("SKIPPED: DATABASE_URL is not set, so no knowledge-base database tests were run.");
  process.exit(0);
}
process.env.KB_ENCRYPTION_KEY = "t".repeat(40);
let passed = 0, failed = 0;
const failures: string[] = [];
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; failures.push(name); console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 5).join("\n    ")}`); }
}

async function main() {
  const dbName = `jyntra_kb_${process.pid}_${Date.now() % 100000}`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  admin.on("error", () => {});
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(base!);
  u.pathname = "/" + dbName;
  process.env.DATABASE_URL = u.toString();

  const { query, pool } = await import("@/lib/database");
  const users = await import("@/lib/users");
  const store = await import("@/lib/kb/store");
  const { syncSource } = await import("@/lib/kb/sync");
  const { searchChunks, projectOverview } = await import("@/lib/kb/search");
  const { answerQuestion, defaultDeps } = await import("@/lib/kb/answer");
  const { saveExchange, getConversation } = await import("@/lib/kb/conversations");
  const { encryptSecret } = await import("@/lib/kb/crypto");
  const profile = { name: "X", skills: ["Python"], target_roles: ["Backend Engineer"], tech_experience_years: 2, projects: [] } as any;
  const mk = async (name: string) => (await users.createUser({ ...profile, name })).user;
  const A = await mk("A");
  const B = await mk("B");
  const count = async (sql: string, p: unknown[] = []) => Number((await query(sql, p))[0].c);

  const ghSource = async (uid: number, token = true) =>
    store.createSource(uid, { provider: "github", label: "GitHub: me", config: { login: "me", repos: [], includePrivate: false }, credentialsEnc: token ? encryptSecret("tok") : null });
  const gh = (o = {}) => ({ fetchImpl: fakeFetch(githubRoutes(o)) });
  const aiDeps = (text = "It is a Next.js app with PostgreSQL [S1].") => ({ ...defaultDeps({}), aiConfigured: () => true, complete: async () => ({ text, provider: "groq" }) });

  console.log("GitHub sync, retrieval and citations");
  const srcA = await ghSource(A.id);
  await t("a successful sync marks the source connected and indexes README/manifest/source", async () => {
    const r = await syncSource(A.id, srcA.id, gh());
    assert.equal(r.ok, true, JSON.stringify(r));
    const s = await store.getSource(A.id, srcA.id);
    assert.equal(s!.status, "connected");
    assert.ok(s!.last_synced_at);
    assert.ok((await count("SELECT count(*) c FROM kb_chunks WHERE user_id = $1", [A.id])) > 3);
    const ents = await store.listEntities(A.id);
    assert.equal(ents.find((e) => e.kind === "project" && e.name === "alpha")?.level, "demonstrated");
    assert.equal(ents.find((e) => e.kind === "skill" && e.name === "Next.js")?.level, "demonstrated");
    assert.equal(ents.find((e) => e.kind === "skill" && e.name === "Python")?.level, "self_reported");
  });
  await t("secrets and excluded files never reached the database", async () => {
    assert.equal(await count("SELECT count(*) c FROM kb_documents WHERE user_id = $1 AND (external_id LIKE '%.env%' OR external_id LIKE '%.pem' OR external_id LIKE '%id_rsa%' OR external_id LIKE '%package-lock%')", [A.id]), 0);
    assert.equal(await count("SELECT count(*) c FROM kb_chunks WHERE content ~ 'hunter2pass|supersecretvalue1|ghp_a{36}'"), 0);
  });
  await t("incremental sync: unchanged docs are not rewritten; a changed file updates one document", async () => {
    const before = await query("SELECT id, content_hash, synced_at FROM kb_documents WHERE user_id = $1 ORDER BY id", [A.id]);
    const chunkIds = (await query("SELECT id FROM kb_chunks WHERE user_id = $1 ORDER BY id", [A.id])).map((r) => r.id).join(",");
    const r = await syncSource(A.id, srcA.id, gh());
    assert.equal(r.stats!.added, 0);
    assert.equal(r.stats!.updated, 0);
    assert.equal(r.stats!.unchanged, before.length);
    assert.equal((await query("SELECT id FROM kb_chunks WHERE user_id = $1 ORDER BY id", [A.id])).map((x) => x.id).join(","), chunkIds, "chunks untouched");
    const routes = githubRoutes();
    const f2 = fakeFetch([[/\/readme/, { content: Buffer.from("# Alpha\nNow with Redis caching.").toString("base64"), path: "README.md", html_url: "https://github.com/me/alpha/blob/main/README.md" }], ...routes]);
    const r2 = await syncSource(A.id, srcA.id, { fetchImpl: f2 });
    assert.ok(r2.stats!.updated >= 1 && r2.stats!.added === 0, JSON.stringify(r2.stats));
    assert.equal(await count("SELECT count(*) c FROM kb_documents WHERE user_id = $1 AND content LIKE '%Redis caching%'", [A.id]) >= 1, true);
  });
  await t("a repository removed at the source is removed from the index on a complete sync", async () => {
    const routes = githubRoutes().map((r) => (String(r[0]).includes("/users/me/repos") || r[0] === "https://api.github.com/user/repos" ? [r[0], (r[1] as any[]).filter((x) => x.name !== "beta")] : r)) as any;
    const before = await count("SELECT count(*) c FROM kb_documents WHERE user_id = $1 AND project = 'beta'", [A.id]);
    assert.ok(before > 0);
    const r = await syncSource(A.id, srcA.id, { fetchImpl: fakeFetch(routes) });
    assert.ok(r.stats!.removed > 0);
    assert.equal(await count("SELECT count(*) c FROM kb_documents WHERE user_id = $1 AND project = 'beta'", [A.id]), 0);
    await syncSource(A.id, srcA.id, gh()); // restore for later tests
  });
  await t("search ranks relevant chunks first and is bounded", async () => {
    const hits = await searchChunks(A.id, "Next.js app architecture PostgreSQL", { limit: 5 });
    assert.ok(hits.length > 0 && hits.length <= 5);
    assert.ok(hits.some((h) => /Architecture|Next\.js/i.test(h.content)));
    assert.deepEqual(await searchChunks(A.id, "zzzqqqxxx nonexistentterm"), []);
  });
  await t("a project question returns an answer with citations pointing at this user's documents", async () => {
    const r = await answerQuestion(A as any, { question: "Explain how I built my alpha project" }, aiDeps());
    assert.equal(r.grounded, true);
    assert.ok(r.citations[0].documentId);
    const [d] = await query("SELECT user_id FROM kb_documents WHERE id = $1", [r.citations[0].documentId]);
    assert.equal(d.user_id, A.id);
    assert.ok(r.citations[0].url?.startsWith("https://github.com/"));
  });

  console.log("portfolio overview on a real database");
  await t("overview lists every indexed project once, honours provider and exclusion, and never shows another user's projects", async () => {
    const all = await projectOverview(A.id, {});
    const names = all.filter((h) => h.project).map((h) => h.project!.toLowerCase());
    assert.ok(names.length >= 1, "A has indexed projects");
    assert.equal(new Set(names).size, names.length, "one document per project");
    assert.ok(all.every((h) => h.chunkId < 0 && h.content.length > 0));
    const gh = await projectOverview(A.id, { providers: ["github"] });
    assert.ok(gh.length > 0 && gh.every((h) => h.provider === "github"));
    const rest = await projectOverview(A.id, { exclude: [names[0]] });
    assert.ok(!rest.some((h) => h.project?.toLowerCase() === names[0]));
    assert.deepEqual(await projectOverview(B.id, {}), [], "user B sees none of A's projects");
    assert.deepEqual(await projectOverview(A.id, { sourceIds: [999999] }), [], "unknown source scope returns nothing");
  });

  console.log("isolation between users");
  await t("user B sees nothing of A: sources, documents, search, entities, answers", async () => {
    assert.equal(await store.getSource(B.id, srcA.id), null);
    assert.equal((await store.listSources(B.id)).length, 0);
    assert.deepEqual(await searchChunks(B.id, "Next.js app architecture PostgreSQL"), []);
    assert.equal((await store.listEntities(B.id)).filter((e) => e.kind === "project").length, 0);
    const r = await answerQuestion(B as any, { question: "Explain how I built my alpha project" }, aiDeps());
    assert.equal(r.insufficient, true);
    assert.equal(r.citations.length, 0);
  });
  await t("guessing A's source or document ids as B changes nothing", async () => {
    assert.equal(await store.disconnectSource(B.id, srcA.id, true), false);
    const [d] = await query("SELECT id FROM kb_documents WHERE user_id = $1 LIMIT 1", [A.id]);
    await store.deleteDocuments(B.id, [d.id]);
    assert.equal(await count("SELECT count(*) c FROM kb_documents WHERE id = $1", [d.id]), 1);
    const r = await syncSource(B.id, srcA.id, gh());
    assert.equal(r.skipped, "not_found");
    assert.deepEqual(await searchChunks(B.id, "Next.js", { sourceIds: [srcA.id] }), []);
    assert.equal((await getConversation(B.id, 999999)), null);
  });
  await t("a conversation id belonging to A is not appended to by B", async () => {
    const a = await saveExchange(A.id, { mode: "auto", question: "q", answer: "a", citations: [], meta: {} });
    const b = await saveExchange(B.id, { conversationId: a.conversationId, mode: "auto", question: "q2", answer: "a2", citations: [], meta: {} });
    assert.notEqual(b.conversationId, a.conversationId);
    assert.equal(await count("SELECT count(*) c FROM kb_messages WHERE conversation_id = $1 AND user_id = $2", [a.conversationId, B.id]), 0);
  });

  console.log("documents, duplicates, failures");
  await t("upload-style documents are retrievable; the same content from another source is a duplicate", async () => {
    const up = await store.createSource(A.id, { provider: "upload", label: "Uploaded documents", status: "connected" });
    const doc = { externalId: "file:resume.pdf", docType: "resume" as const, title: "resume.pdf", content: "Asha Rao\nExperience\nBackend intern at Foo building Kafka pipelines.\nEducation\nB.Tech Computer Science" };
    const s1 = await store.storeDocuments(A.id, up.id, "upload", [doc], { complete: false });
    assert.equal(s1.added, 1);
    const up2 = await store.createSource(A.id, { provider: "notes", label: "Notes", status: "connected" });
    const s2 = await store.storeDocuments(A.id, up2.id, "notes", [{ ...doc, externalId: "note:1", docType: "note" as const }], { complete: false });
    assert.equal(s2.duplicates, 1);
    assert.equal(s2.added, 0);
    const hits = await searchChunks(A.id, "Kafka pipelines intern");
    assert.ok(hits.some((h) => h.title === "resume.pdf"));
    await store.rebuildEntities(A.id);
    const ents = await store.listEntities(A.id);
    assert.ok(ents.some((e) => e.kind === "experience" && e.level === "unverified"), "resume claims stay unverified");
  });
  await t("inventory on a real DB: resume + GitHub projects merged once, resume-only project kept, 'only GitHub' restricts, other users see none, no model needed", async () => {
    const up = (await query<any>("SELECT id FROM kb_sources WHERE user_id = $1 AND provider = 'upload'", [A.id]))[0];
    await store.storeDocuments(A.id, up.id, "upload", [{ externalId: "file:resume2.pdf", docType: "resume" as const, title: "resume2.pdf", content: "Asha Rao\nPROJECTS\nalpha | Next.js, PostgreSQL\n• Built the web app.\nResume Only App | Python, FastAPI\n• Built a classifier service.\nEDUCATION\nB.Tech" }], { complete: false });
    await store.rebuildEntities(A.id);
    const deadModel = { ...defaultDeps({}), aiConfigured: () => false, complete: async () => { throw new Error("model must not be called"); } };
    const all = await answerQuestion(A as any, { question: "list all my projects" }, deadModel as any);
    assert.equal((all.answer.match(/\*\*alpha\*\*/g) ?? []).length, 1);
    assert.equal((all.answer.match(/\*\*Resume Only App\*\*/g) ?? []).length, 1);
    assert.match(all.answer, /Resume\/profile claim only/);
    const gh = await answerQuestion(A as any, { question: "Only use GitHub: list all my projects" }, deadModel as any);
    assert.ok(gh.answer.includes("**alpha**") && !gh.answer.includes("Resume Only App"));
    const forB = await answerQuestion(B as any, { question: "list all my projects" }, deadModel as any);
    assert.equal(forB.insufficient, true); assert.ok(!forB.answer.includes("alpha"));
    assert.equal((await searchChunks(A.id, "Kafka pipelines intern", { providers: ["github"] })).length, 0);
    assert.equal((await searchChunks(B.id, "Kafka pipelines intern")).length, 0);
  });
  await t("activity records: applications, answer sets and drafts are loaded for the owner only, with real counts", async () => {
    const { loadActivity } = await import("@/lib/kb/activity");
    const [st] = await query<any>("INSERT INTO startups (name, normalized_name, source) VALUES ('Acme','acme-act','yc') RETURNING id");
    const [ap] = await query<any>("INSERT INTO applications (user_id, startup_id, status) VALUES ($1,$2,'Applied') RETURNING id", [A.id, st.id]);
    const [set] = await query<any>("INSERT INTO app_answer_sets (user_id, application_id, title) VALUES ($1,$2,'Acme form') RETURNING id", [A.id, ap.id]);
    await query("INSERT INTO app_answers (user_id, set_id, position, question, answer, status) VALUES ($1,$2,0,'Why us?','x','complete'), ($1,$2,1,'Salary?','', 'needs_input')", [A.id, set.id]);
    await query("INSERT INTO email_drafts (user_id, to_email, subject, body, status, application_id) VALUES ($1,'hr@acme.com','Hi','b','sent',$2), ($1,'x@y.com','Later','b','draft',NULL)", [A.id, ap.id]);
    const a = await loadActivity(A.id);
    assert.equal(a.apps.length, 1); assert.equal(a.apps[0].company, "Acme");
    assert.deepEqual([a.sets[0].total, a.sets[0].complete, a.sets[0].needs], [2, 1, 1]);
    assert.equal(a.drafts.length, 2);
    const b = await loadActivity(B.id);
    assert.deepEqual([b.apps.length, b.sets.length, b.drafts.length], [0, 0, 0]);
  });
  await t("a revoked token marks the source revoked, clears the credential and never reports healthy", async () => {
    const s = await ghSource(A.id);
    const r = await syncSource(A.id, s.id, { fetchImpl: fakeFetch([[/api\.github\.com/, { status: 401, json: { message: "Bad credentials" } }]]) });
    assert.equal(r.ok, false);
    const row = await store.getSource(A.id, s.id);
    assert.equal(row!.status, "revoked");
    assert.equal(row!.credentials_enc, null);
    assert.equal(row!.last_synced_at, null);
    assert.ok(row!.last_error);
  });
  await t("provider rate limit: partial results are kept, the source stays usable with a warning", async () => {
    const s = await ghSource(A.id);
    const r = await syncSource(A.id, s.id, { fetchImpl: fakeFetch(githubRoutes({ rateLimitOn: "/beta/" })) });
    assert.equal(r.ok, true);
    assert.ok(r.warnings!.some((w) => /rate limit/i.test(w)));
    assert.equal((await store.getSource(A.id, s.id))!.last_stats.complete, false);
  });
  await t("two concurrent syncs of one source: only one runs", async () => {
    const s = await ghSource(B.id);
    const inner = fakeFetch(githubRoutes());
    const slow = (async (i: any, init?: any) => { await new Promise((r) => setTimeout(r, 300)); return inner(i, init); }) as typeof fetch;
    const [x, y] = await Promise.all([syncSource(B.id, s.id, { fetchImpl: slow }), syncSource(B.id, s.id, { fetchImpl: slow })]);
    assert.equal([x, y].filter((r) => r.skipped === "already_running").length, 1);
  });
  await t("credentials are encrypted at rest and never in public source JSON", async () => {
    const [row] = await query("SELECT credentials_enc FROM kb_sources WHERE id = $1", [srcA.id]);
    assert.ok(row.credentials_enc.startsWith("v1.") && !row.credentials_enc.includes("tok."));
    const pub = JSON.stringify(store.publicSource((await store.getSource(A.id, srcA.id))!));
    assert.ok(!pub.includes("credentials_enc") && !pub.includes(row.credentials_enc));
  });

  console.log("disconnect and deletion");
  await t("disconnect without purge stops syncing, clears the credential, keeps the index", async () => {
    await store.deleteAllKnowledge(B.id); // identical content in another source would count as a duplicate
    const s = await ghSource(B.id);
    await syncSource(B.id, s.id, gh());
    const n = await count("SELECT count(*) c FROM kb_documents WHERE source_id = $1", [s.id]);
    assert.ok(n > 0);
    assert.equal(await store.disconnectSource(B.id, s.id, false), true);
    const row = await store.getSource(B.id, s.id);
    assert.equal(row!.status, "disconnected");
    assert.equal(row!.credentials_enc, null);
    assert.equal((await syncSource(B.id, s.id, gh())).skipped, "disconnected");
    assert.equal(await count("SELECT count(*) c FROM kb_documents WHERE source_id = $1", [s.id]), n);
  });
  await t("purge deletes documents, chunks, entities AND the answers/notes derived from them", async () => {
    await store.deleteAllKnowledge(B.id); // identical content in another source would count as a duplicate
    const s = await ghSource(B.id);
    await syncSource(B.id, s.id, gh());
    const r = await answerQuestion(B as any, { question: "Explain how I built my alpha project" }, aiDeps());
    assert.equal(r.grounded, true);
    await saveExchange(B.id, { mode: "auto", question: "q", answer: r.answer, citations: r.citations, meta: {} });
    const docIds = r.citations.map((c) => c.documentId!);
    await query("INSERT INTO kb_notes (user_id, kind, title, content, document_ids) VALUES ($1,'prep','n','c',$2)", [B.id, docIds]);
    await query("INSERT INTO kb_notes (user_id, kind, title, content) VALUES ($1,'prep','keep me','manual note')", [B.id]);
    await store.disconnectSource(B.id, s.id, true);
    assert.equal(await count("SELECT count(*) c FROM kb_documents WHERE user_id = $1 AND source_id = $2", [B.id, s.id]), 0);
    assert.equal(await count("SELECT count(*) c FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id WHERE d.source_id = $1", [s.id]), 0);
    assert.equal(await count("SELECT count(*) c FROM kb_messages WHERE user_id = $1 AND document_ids && $2::int[]", [B.id, docIds]), 0);
    assert.equal(await count("SELECT count(*) c FROM kb_notes WHERE user_id = $1 AND document_ids && $2::int[]", [B.id, docIds]), 0);
    assert.equal(await count("SELECT count(*) c FROM kb_notes WHERE user_id = $1 AND title = 'keep me'", [B.id]), 1, "user-written notes without sources survive");
    assert.equal((await store.listEntities(B.id)).filter((e) => e.kind === "project").length, 0);
    assert.equal(await count("SELECT count(*) c FROM kb_sources WHERE id = $1", [s.id]), 0);
  });
  await t("delete everything removes all of one user's knowledge and nothing of another's", async () => {
    const before = await count("SELECT count(*) c FROM kb_documents WHERE user_id = $1", [A.id]);
    assert.ok(before > 0);
    await store.deleteAllKnowledge(B.id);
    assert.equal(await count("SELECT count(*) c FROM kb_documents WHERE user_id = $1", [B.id]), 0);
    assert.equal(await count("SELECT count(*) c FROM kb_documents WHERE user_id = $1", [A.id]), before);
    await store.deleteAllKnowledge(A.id);
    for (const tbl of ["kb_sources", "kb_documents", "kb_chunks", "kb_entities", "kb_messages", "kb_notes", "kb_conversations"]) assert.equal(await count(`SELECT count(*) c FROM ${tbl} WHERE user_id = $1`, [A.id]), 0, tbl);
  });
  await t("audit log records actions without credentials or prompt text", async () => {
    const rows = await query("SELECT action, detail FROM kb_audit");
    assert.ok(rows.length > 0);
    assert.ok(!JSON.stringify(rows).match(/tok\b|ghp_|Bearer/));
  });

  pool().on("error", () => {});
  await pool().end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED: ${failures.join("; ")}` : ""}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("test-kb-db crashed:", e); process.exit(2); });
