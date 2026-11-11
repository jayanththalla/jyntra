// Atlas index freshness on a REAL PostgreSQL (throw-away database). DATABASE_URL=postgres://… npx tsx scripts/test-atlas-db.ts
import assert from "node:assert/strict";
import { Client } from "pg";

const base = process.env.DATABASE_URL;
if (!base) { console.log("SKIPPED: DATABASE_URL is not set, so no Atlas freshness tests were run."); process.exit(0); }
process.env.KB_ENCRYPTION_KEY = "t".repeat(40);
let passed = 0, failed = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 5).join("\n    ")}`); }
}

async function main() {
  const dbName = `jyntra_atlas_${process.pid}_${Date.now() % 100000}`;
  const admin = new Client({ connectionString: base });
  await admin.connect(); admin.on("error", () => {});
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(base!); u.pathname = "/" + dbName; process.env.DATABASE_URL = u.toString();

  const { query, pool } = await import("@/lib/database");
  pool().on("error", () => {});
  const users = await import("@/lib/users");
  const fr = await import("@/lib/kb/freshness");
  const { buildInventory, renderInventory } = await import("@/lib/kb/inventory");
  const mk = async (name: string) => (await users.createUser({ name, skills: ["Python"], target_roles: ["Backend"], tech_experience_years: 2, projects: [] } as any)).user;
  const A = await mk("A"), B = await mk("B");
  const H = 3_600_000;
  const NOW = Date.now();
  const src = async (uid: number, provider: string, o: { status?: string; syncedAgoH?: number | null; attemptAgoMin?: number | null; probeAgoMin?: number | null } = {}) => {
    const [r] = await query<{ id: number }>(
      `INSERT INTO kb_sources (user_id, provider, label, status, config, last_synced_at, last_attempt_at, last_probe_at)
       VALUES ($1,$2,$3,$4,'{"login":"me","handle":"me"}', $5, $6, $7) RETURNING id`,
      [uid, provider, provider === "github" ? "GitHub: me" : provider, o.status ?? "connected",
       o.syncedAgoH == null ? null : new Date(NOW - o.syncedAgoH * H), o.attemptAgoMin == null ? null : new Date(NOW - o.attemptAgoMin * 60_000), o.probeAgoMin == null ? null : new Date(NOW - o.probeAgoMin * 60_000)]
    );
    return r.id;
  };
  const reset = () => query("TRUNCATE kb_sources RESTART IDENTITY CASCADE");
  const mkDeps = (probeResult: { latestChangeAt: string | null } | null | Error = null) => {
    const calls = { sync: [] as number[], probe: [] as number[] };
    return { calls, deps: { now: () => NOW, queueSync: (_u: number, id: number) => { calls.sync.push(id); }, probe: async (s: { id: number }) => { calls.probe.push(s.id); if (probeResult instanceof Error) throw probeResult; return probeResult; } } };
  };

  console.log("freshness decisions");
  await t("a recently synced GitHub source is fresh and nothing is queued", async () => {
    await reset(); const id = await src(A.id, "github", { syncedAgoH: 1, probeAgoMin: 1 });
    const { calls, deps } = mkDeps(); const out = await fr.ensureFresh(A.id, deps);
    assert.equal(out[0].state, "fresh"); assert.equal(out[0].notice, null); assert.deepEqual(calls.sync, []); assert.equal(out[0].sourceId, id);
  });
  await t("an old index is stale: a refresh is queued and the notice does NOT claim it is current", async () => {
    await reset(); const id = await src(A.id, "github", { syncedAgoH: 30 });
    const { calls, deps } = mkDeps(); const out = await fr.ensureFresh(A.id, deps);
    assert.equal(out[0].state, "stale"); assert.deepEqual(calls.sync, [id]); assert.match(out[0].notice!, /last indexed 30 h ago/); assert.match(out[0].notice!, /refresh is queued/); assert.doesNotMatch(out[0].notice!, /up to date|in sync/i);
  });
  await t("a probe that sees a newer change marks the index stale, records the observation and queues one sync", async () => {
    await reset(); const id = await src(A.id, "github", { syncedAgoH: 2, probeAgoMin: 60 });
    const { calls, deps } = mkDeps({ latestChangeAt: new Date(NOW - 30 * 60_000).toISOString() }); const out = await fr.ensureFresh(A.id, deps);
    assert.equal(out[0].state, "stale"); assert.match(out[0].notice!, /newer changes/); assert.deepEqual(calls.sync, [id]);
    const [r] = await query("SELECT update_observed_at, last_probe_at FROM kb_sources WHERE id = $1", [id]); assert.ok(r.update_observed_at && r.last_probe_at);
  });
  await t("a probe older than the last sync changes nothing", async () => {
    await reset(); await src(A.id, "github", { syncedAgoH: 2, probeAgoMin: 60 });
    const { calls, deps } = mkDeps({ latestChangeAt: new Date(NOW - 5 * H).toISOString() }); const out = await fr.ensureFresh(A.id, deps);
    assert.equal(out[0].state, "fresh"); assert.deepEqual(calls.sync, []);
  });
  await t("probes are rate limited per source (no probe within 10 minutes)", async () => {
    await reset(); await src(A.id, "github", { syncedAgoH: 2, probeAgoMin: 3 });
    const { calls, deps } = mkDeps({ latestChangeAt: new Date(NOW).toISOString() }); await fr.ensureFresh(A.id, deps);
    assert.deepEqual(calls.probe, []); assert.deepEqual(calls.sync, []);
  });
  await t("a failing probe is ignored: the answer is not blocked and nothing is queued", async () => {
    await reset(); await src(A.id, "github", { syncedAgoH: 2, probeAgoMin: 60 });
    const { calls, deps } = mkDeps(new Error("boom")); const out = await fr.ensureFresh(A.id, deps);
    assert.equal(out[0].state, "fresh"); assert.deepEqual(calls.sync, []);
  });
  await t("a failed sync keeps the last successful index visible and is retried only after the backoff", async () => {
    await reset(); const early = await src(A.id, "github", { status: "error", syncedAgoH: 5, attemptAgoMin: 5 }); const late = await src(A.id, "codeforces", { status: "error", syncedAgoH: 5, attemptAgoMin: 120 });
    const { calls, deps } = mkDeps(); const out = await fr.ensureFresh(A.id, deps);
    assert.deepEqual(calls.sync, [late]); const e = out.find((x) => x.sourceId === early)!;
    assert.equal(e.state, "failed"); assert.match(e.notice!, /last successful index from 5 h ago/);
  });
  await t("revoked access is never retried automatically and says to reconnect", async () => {
    await reset(); await src(A.id, "github", { status: "revoked", syncedAgoH: 50, attemptAgoMin: 999 });
    const { calls, deps } = mkDeps(); const out = await fr.ensureFresh(A.id, deps);
    assert.deepEqual(calls.sync, []); assert.match(out[0].notice!, /Reconnect/);
  });
  await t("a source that is syncing right now is reported as refreshing, not queued twice", async () => {
    await reset(); await src(A.id, "github", { status: "syncing", syncedAgoH: 40, attemptAgoMin: 1 });
    const { calls, deps } = mkDeps(); const out = await fr.ensureFresh(A.id, deps);
    assert.equal(out[0].state, "syncing"); assert.deepEqual(calls.sync, []);
  });
  await t("uploads and notes never go stale; a never-synced source says so", async () => {
    await reset(); await src(A.id, "upload", { syncedAgoH: 24 * 90 }); await src(A.id, "github", { syncedAgoH: null });
    const { calls, deps } = mkDeps(); const out = await fr.ensureFresh(A.id, deps);
    assert.equal(out.find((x) => x.provider === "upload")!.state, "manual"); assert.equal(out.find((x) => x.provider === "github")!.state, "never");
    assert.equal(calls.sync.length, 1, "only the never-synced GitHub source is queued");
  });

  console.log("isolation and citations");
  await t("another user's sources are never read or queued", async () => {
    await reset(); await src(A.id, "github", { syncedAgoH: 99 }); const bId = await src(B.id, "github", { syncedAgoH: 99 });
    const { calls, deps } = mkDeps(); const out = await fr.ensureFresh(B.id, deps);
    assert.deepEqual(calls.sync, [bId]); assert.equal(out.length, 1); assert.equal(out[0].sourceId, bId);
    assert.deepEqual(await fr.loadSources(B.id, [bId + 1000]), []);
  });
  await t("each citation carries ITS source's own last-sync time", async () => {
    const fresh = [
      { sourceId: 1, provider: "github", label: "GitHub: me", state: "stale" as const, lastSyncedAt: "2026-10-27T08:00:00.000Z", notice: null },
      { sourceId: 2, provider: "upload", label: "Resume", state: "manual" as const, lastSyncedAt: "2026-10-01T08:00:00.000Z", notice: null },
    ];
    const out = fr.annotateCitations([{ documentId: 10 }, { documentId: 11 }, { documentId: 99 }, { documentId: null }], new Map([[10, 1], [11, 2]]), fresh);
    assert.equal(out[0].source?.lastSyncedAt, "2026-10-27T08:00:00.000Z"); assert.equal(out[1].source?.label, "Resume"); assert.equal(out[2].source, undefined); assert.equal(out[3].source, undefined);
  });

  console.log("connector probes (fake fetch)");
  await t("GitHub probe reads only the newest push time; Codeforces probe reads the newest submission", async () => {
    const { githubConnector } = await import("@/lib/kb/connectors/github");
    const { codeforcesConnector } = await import("@/lib/kb/connectors/codeforces");
    const seen: string[] = [];
    const gh = (async (url: string) => { seen.push(String(url)); return new Response(JSON.stringify([{ pushed_at: "2026-10-28T10:00:00Z" }]), { status: 200 }); }) as unknown as typeof fetch;
    assert.equal((await githubConnector.probe!({ config: { login: "me" }, token: null, fetchImpl: gh })).latestChangeAt, "2026-10-28T10:00:00.000Z");
    assert.match(seen[0], /\/users\/me\/repos\?sort=pushed&per_page=1/);
    const cf = (async () => new Response(JSON.stringify({ status: "OK", result: [{ creationTimeSeconds: 1793000000 }] }), { status: 200 })) as unknown as typeof fetch;
    assert.ok((await codeforcesConnector.probe!({ config: { handle: "tourist" }, token: null, fetchImpl: cf })).latestChangeAt);
    const bad = (async () => new Response("nope", { status: 200 })) as unknown as typeof fetch;
    assert.equal((await githubConnector.probe!({ config: { login: "me" }, token: null, fetchImpl: bad })).latestChangeAt, null);
  });

  console.log("complete inventory");
  await t("30 projects from two sources: every project once, correct count, none truncated", async () => {
    const ents: any[] = [];
    for (let i = 1; i <= 30; i++) ents.push({ kind: "project", name: `Project-${i}`, level: "demonstrated", data: { provider: "github", technologies: ["TypeScript"], description: `Project number ${i} does a distinct and useful thing.` } });
    for (let i = 1; i <= 10; i++) ents.push({ kind: "project", name: `project ${i}`, level: "self_reported", data: { provider: "upload", technologies: ["Docker"] } }); // same projects, resume spelling
    ents.push({ kind: "project", name: "octocat-readme", level: "demonstrated", data: { provider: "github" } }); // profile repo is not a project
    const items = buildInventory(ents, []);
    assert.equal(items.length, 30); assert.equal(new Set(items.map((x) => x.key)).size, 30);
    const md = renderInventory(items); assert.match(md, /\*\*30\*\* distinct projects/); for (let i = 1; i <= 30; i++) assert.match(md, new RegExp(`\\*\\*Project-${i}\\*\\*`));
    assert.doesNotMatch(md, /octocat-readme/);
    assert.deepEqual(items.find((x) => x.name === "Project-3")!.tech.sort(), ["Docker", "TypeScript"]);
  });
  await t("an inventory limited to one source lists only that source's projects", async () => {
    const ents: any[] = [{ kind: "project", name: "Alpha", level: "demonstrated", data: { provider: "github" } }, { kind: "project", name: "Beta", level: "self_reported", data: { provider: "upload" } }];
    assert.deepEqual(buildInventory(ents, [], { onlyProviders: ["upload"] }).map((x) => x.name), ["Beta"]);
  });

  await pool().end(); await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`); await admin.end();
  console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
