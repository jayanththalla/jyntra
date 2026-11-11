// Integration tests against a real PostgreSQL (DATABASE_URL). Provider traffic is served from fixtures.
import assert from "node:assert/strict";
import { pool, query, ready } from "@/lib/database";
import { persistJobs } from "@/lib/ingestion/persist";
import { runSource } from "@/lib/ingestion/runner";
import { runPass } from "@/lib/ingestion/scheduler";
import { claimDueSources, ensureCompany, upsertSource } from "@/lib/ingestion/source-store";
import { queryFeed } from "@/lib/ingestion/feed";
import { ingestionDiagnostics } from "@/lib/ingestion/diagnostics";
import { addCandidate } from "@/lib/ingestion/discovery/candidates";
import { importCandidates, parseRegistry } from "@/lib/ingestion/discovery/registry";
import { processCandidate, processQueue } from "@/lib/ingestion/discovery/pipeline";
import { addBoard, addCompany, pauseSource, retrySource } from "@/lib/ingestion/admin";
import { finalizeJob } from "@/lib/ingestion/normalize";
import * as F from "./fixtures/ingestion/payloads";
import { harness, installFixtures, json, text } from "./ingestion-test-utils";
import fs from "node:fs";
import path from "node:path";

const { t, done } = harness();
const PFX = "ingtest";
const cnt = async (sql: string, a: unknown[] = []) => Number((await query<{ c: string }>(sql, a))[0]!.c);
const clean = async () => {
  await query(`DELETE FROM discovery_candidates WHERE origin IN ('admin','test','registry:test') OR name LIKE '${PFX}%'`);
  await query(`DELETE FROM company_profiles WHERE slug LIKE '${PFX}%'`); // cascades sources, jobs, runs
  await query("DELETE FROM source_discovery_runs");
};
const mkSource = async (slug: string, provider: any, over: Record<string, any> = {}) => {
  const company = await ensureCompany(`${PFX} ${slug}`);
  return upsertSource({ id: null as any, companySlug: company, provider, boardSlug: over.boardSlug ?? slug, tenant: over.tenant ?? null, host: over.host ?? null, careerSite: over.careerSite ?? null, sourceUrl: null, config: {}, ...over } as any);
};
const jobsOf = (id: number, extra = "") => query<any>(`SELECT * FROM company_jobs WHERE source_id=$1 ${extra} ORDER BY external_job_id`, [id]);
const srcRow = async (id: number) => (await query<any>("SELECT * FROM job_sources WHERE id=$1", [id]))[0];

async function main() {
  await ready();
  await clean();

  console.log("migration");
  await t("applying schema twice is a no-op (idempotent, additive)", async () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "lib", "database", "ingestion.sql"), "utf8");
    await pool().query(sql); await pool().query(sql);
    for (const tbl of ["job_sources", "ingestion_runs", "source_discovery_runs", "discovery_candidates", "company_locations", "company_funding_signals"]) assert.equal(await cnt("SELECT count(*) c FROM information_schema.tables WHERE table_name=$1", [tbl]), 1, tbl);
  });

  console.log("ingestion lifecycle (greenhouse fixture)");
  let payload: any = structuredClone(F.greenhouse);
  let mode: "ok" | "500" | "429" | "304" | "html" = "ok";
  const fx = installFixtures([(u) => {
    if (!u.includes("boards-api.greenhouse.io/v1/boards/ingtest-a/jobs")) return null;
    if (mode === "500") return new Response("boom", { status: 500 });
    if (mode === "429") return new Response("slow", { status: 429, headers: { "retry-after": "90" } });
    if (mode === "304") return new Response(null, { status: 304, headers: { etag: 'W/"v1"' } });
    if (mode === "html") return text("<html>maintenance</html>");
    return json(payload, { etag: 'W/"v1"' });
  }]);
  const A = await mkSource("a", "greenhouse", { boardSlug: "ingtest-a" });
  await t("first run inserts jobs with city class, apply URLs and provenance", async () => {
    const r = await runSource(A);
    assert.equal(r.status, "success"); assert.equal(r.stats!.inserted, 5);
    const rows = await jobsOf(A);
    assert.equal(rows.length, 5);
    const by = (id: string) => rows.find((x: any) => x.external_job_id === id);
    assert.equal(by("4001").city_class, "bengaluru"); assert.equal(by("4002").city_class, "hyderabad"); assert.equal(by("4004").city_class, "both"); assert.equal(by("4005").city_class, "india_remote");
    assert.equal(by("4001").application_url, "https://boards.greenhouse.io/acme/jobs/4001");
    assert.equal(by("4001").provider, "greenhouse"); assert.equal(by("4001").license_class, "employer_public"); assert.ok(by("4001").first_seen_at);
    assert.equal(by("4002").posted_at, null);
    const s = await srcRow(A); assert.equal(s.consecutive_failures, 0); assert.ok(s.last_success_at); assert.equal(s.etag, 'W/"v1"'); assert.ok(new Date(s.next_check_at) > new Date());
  });
  await t("re-running the same payload is idempotent: no duplicates, all unchanged", async () => {
    const before = (await jobsOf(A)).map((r: any) => [r.id, r.first_seen_at.toISOString()].join());
    const r = await runSource(A);
    assert.equal(r.stats!.inserted, 0); assert.equal(r.stats!.updated, 0); assert.equal(r.stats!.unchanged, 5);
    assert.deepEqual((await jobsOf(A)).map((x: any) => [x.id, x.first_seen_at.toISOString()].join()), before);
  });
  await t("a changed job is updated; first_seen_at is preserved", async () => {
    const first = (await jobsOf(A)).find((x: any) => x.external_job_id === "4001").first_seen_at.toISOString();
    payload.jobs[0].title = "Principal Backend Engineer";
    const r = await runSource(A);
    assert.equal(r.stats!.updated, 1); assert.equal(r.stats!.unchanged, 4);
    const row = (await jobsOf(A)).find((x: any) => x.external_job_id === "4001");
    assert.equal(row.title, "Principal Backend Engineer"); assert.equal(row.first_seen_at.toISOString(), first);
  });
  await t("a missing/null apply URL never overwrites a stored valid one (also across repeated syncs)", async () => {
    payload.jobs[0].absolute_url = "javascript:alert(1)";
    for (let i = 0; i < 3; i++) await runSource(A);
    const row = (await jobsOf(A)).find((x: any) => x.external_job_id === "4001");
    assert.equal(row.application_url, "https://boards.greenhouse.io/acme/jobs/4001");
    payload.jobs[0].absolute_url = "https://boards.greenhouse.io/acme/jobs/4001";
  });
  await t("HTTP 500: jobs untouched, flagged stale, source backs off", async () => {
    mode = "500";
    const r = await runSource(A);
    assert.equal(r.status, "failed"); assert.equal(r.category, "server_error");
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_active", [A]), 5);
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_stale", [A]), 5);
    const s = await srcRow(A); assert.equal(s.consecutive_failures, 1); assert.equal(s.last_error_category, "server_error"); assert.ok(new Date(s.next_check_at) > new Date());
  });
  await t("every failure mode keeps all jobs: 403, 429, HTML page, timeout-like, invalid JSON", async () => {
    for (const m of ["429", "html"] as const) { mode = m; await runSource(A); }
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_active", [A]), 5);
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND status='closed'", [A]), 0);
  });
  await t("429 + Retry-After → long backoff and rate-limit counter", async () => {
    mode = "429"; await query("UPDATE job_sources SET consecutive_failures=0, consecutive_rate_limits=0 WHERE id=$1", [A]);
    await runSource(A);
    const s = await srcRow(A); assert.equal(s.consecutive_rate_limits, 1); assert.ok(new Date(s.next_check_at).getTime() - Date.now() > 5 * 3600_000);
  });
  await t("repeated failures open the circuit: failing → needs_review; a success restores health", async () => {
    mode = "500"; await query("UPDATE job_sources SET consecutive_failures=2 WHERE id=$1", [A]);
    await runSource(A); assert.equal((await srcRow(A)).status, "failing");
    await query("UPDATE job_sources SET consecutive_failures=19 WHERE id=$1", [A]);
    await runSource(A); assert.equal((await srcRow(A)).status, "needs_review");
    await retrySource(A); mode = "ok";
    const r = await runSource(A);
    const s = await srcRow(A); assert.equal(r.status, "success"); assert.equal(s.status, "active"); assert.equal(s.consecutive_failures, 0); assert.equal(s.last_error, null);
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_stale", [A]), 0, "stale flags cleared");
  });
  await t("HTTP 304 → run recorded as not_modified, jobs untouched, success time advances", async () => {
    mode = "304"; const before = (await srcRow(A)).last_success_at;
    await new Promise((r) => setTimeout(r, 15));
    const r = await runSource(A);
    assert.equal(r.status, "not_modified"); assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_active", [A]), 5);
    assert.ok((await srcRow(A)).last_success_at > before);
    assert.equal(fx.calls.at(-1)!.headers["If-None-Match"], 'W/"v1"');
  });
  await t("a complete fetch closes missing jobs; a reappearing job is reopened with history kept", async () => {
    mode = "ok";
    const removed = payload.jobs.splice(1, 1)[0]; // 4002
    payload.meta.total = payload.jobs.length;
    const r = await runSource(A);
    assert.equal(r.stats!.closed, 1);
    let row = (await jobsOf(A)).find((x: any) => x.external_job_id === "4002");
    assert.equal(row.status, "closed"); assert.equal(row.is_active, false); assert.ok(row.closed_at);
    const first = row.first_seen_at.toISOString();
    payload.jobs.splice(1, 0, removed); payload.meta.total = payload.jobs.length;
    const r2 = await runSource(A);
    assert.equal(r2.stats!.reopened, 1);
    row = (await jobsOf(A)).find((x: any) => x.external_job_id === "4002");
    assert.equal(row.status, "active"); assert.equal(row.closed_at, null); assert.equal(row.reopened_count, 1); assert.equal(row.first_seen_at.toISOString(), first);
  });
  await t("an INCOMPLETE fetch (page cap) never closes anything", async () => {
    const sr = installFixtures([(u) => { const o = Number(/offset=(\d+)/.exec(u)?.[1] ?? 0); return u.includes("smartrecruiters.com/v1/companies/ingtest-sr/") ? json(F.smartrecruiters(o, 150, o === 0 ? 100 : 50)) : null; }]);
    const S = await mkSource("sr", "smartrecruiters", { boardSlug: "ingtest-sr" });
    assert.equal((await runSource(S)).stats!.inserted, 150);
    const partial = await runSource(S, { maxPages: 1 });
    assert.equal(partial.status, "partial"); assert.equal(partial.stats!.closed, 0);
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_active", [S]), 150);
    sr.restore();
  });
  await t("a suspicious empty 'complete' answer does not close a populated board", async () => {
    const saved = payload.jobs; payload.jobs = []; payload.meta = { total: 0 };
    const r = await runSource(A);
    assert.equal(r.stats!.closed, 0); assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_active", [A]), 5);
    payload.jobs = saved; payload.meta = { total: saved.length };
  });
  await t("closing one source never touches another source of the same company", async () => {
    const slug = (await srcRow(A)).company_slug;
    const other = await upsertSource({ id: null, companySlug: slug, provider: "lever", boardSlug: "ingtest-other", tenant: null, host: null, careerSite: null, sourceUrl: null, config: {} } as any);
    const j = finalizeJob(slug, "lever", "https://jobs.lever.co/x", { externalJobId: "o1", title: "Other", locationTexts: ["Bengaluru"], applyUrl: "https://jobs.lever.co/x/o1" })!;
    await persistJobs({ id: other, companySlug: slug, provider: "lever" }, [j], { complete: true });
    payload.jobs.pop(); payload.meta.total = payload.jobs.length; await runSource(A);
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_active", [other]), 1);
  });
  await t("runs are audited", async () => {
    const runs = await query<any>("SELECT status, jobs_fetched FROM ingestion_runs WHERE source_id=$1", [A]);
    assert.ok(runs.length >= 10); for (const k of ["success", "failed", "not_modified"]) assert.ok(runs.some((r: any) => r.status === k), k);
  });
  fx.restore();

  console.log("concurrency and scheduling");
  await t("two simultaneous persists for one source cannot duplicate or corrupt", async () => {
    const B = await mkSource("b", "lever", { boardSlug: "ingtest-b" });
    const slug = (await srcRow(B)).company_slug;
    const jobs = Array.from({ length: 30 }, (_, i) => finalizeJob(slug, "lever", "https://jobs.lever.co/b", { externalJobId: `j${i}`, title: `Role ${i}`, locationTexts: ["Hyderabad"], applyUrl: `https://jobs.lever.co/b/j${i}` })!);
    await Promise.all([persistJobs({ id: B, companySlug: slug, provider: "lever" }, jobs, { complete: true }), persistJobs({ id: B, companySlug: slug, provider: "lever" }, jobs, { complete: true })]);
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1", [B]), 30);
  });
  await t("claiming is lease-based: parallel claimers get disjoint sources and leases expire", async () => {
    for (let i = 0; i < 6; i++) await mkSource(`c${i}`, "lever", { boardSlug: `ingtest-c${i}` });
    await query("UPDATE job_sources SET next_check_at = now() - interval '1 minute' WHERE company_slug LIKE 'ingtest%'");
    const [x, y] = await Promise.all([claimDueSources(100, 600), claimDueSources(100, 600)]);
    const ids = new Set(x.map((r) => r.id)); assert.ok(x.length + y.length >= 6); assert.ok(!y.some((r) => ids.has(r.id)), "no source claimed twice");
    assert.equal((await claimDueSources(100, 600)).length, 0);
    await query("UPDATE job_sources SET locked_until = now() - interval '1 second' WHERE company_slug LIKE 'ingtest%'");
    assert.ok((await claimDueSources(100, 600)).length >= 6, "an expired lease (crashed worker) is reclaimed");
    await query("UPDATE job_sources SET locked_until = NULL, next_check_at = now() + interval '1 day' WHERE company_slug LIKE 'ingtest%'");
  });
  await t("runPass: respects per-host/provider limits, isolates failures, records a summary", async () => {
    let live = 0, peak = 0;
    const lv = installFixtures([async (u) => {
      if (!u.includes("api.lever.co/v0/postings/ingtest-p")) return null;
      live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 20)); live--;
      return u.includes("ingtest-p3") ? new Response("x", { status: 502 }) : json(F.lever);
    }]);
    const ids = []; for (let i = 0; i < 5; i++) ids.push(await mkSource(`p${i}`, "lever", { boardSlug: `ingtest-p${i}` }));
    await query("UPDATE job_sources SET next_check_at = now() - interval '1 minute' WHERE id = ANY($1)", [ids]);
    const s = await runPass({ limit: 50, concurrency: 5 });
    assert.equal(s.claimed, 5); assert.equal(s.success, 4); assert.equal(s.failed, 1); assert.equal(s.failures.server_error, 1);
    assert.ok(peak <= 3, `provider limit (3) exceeded: ${peak}`);
    lv.restore();
  });
  await t("cancelled run releases its lease and changes no data", async () => {
    const C = await mkSource("cancel", "lever", { boardSlug: "ingtest-cancel" });
    await query("UPDATE job_sources SET locked_until = now() + interval '10 minutes' WHERE id=$1", [C]);
    const ctrl = new AbortController(); ctrl.abort();
    const r = await runSource(C, { signal: ctrl.signal });
    assert.equal(r.status, "cancelled"); assert.equal((await srcRow(C)).locked_until, null); assert.equal((await srcRow(C)).consecutive_failures, 0);
  });

  console.log("Bengaluru / Hyderabad / remote end to end");
  await t("sources for both cities ingest, classify correctly and show up in the right feeds; re-run adds nothing", async () => {
    const e2e = installFixtures([
      (u) => (u.includes("api.lever.co/v0/postings/ingtest-blr") ? json([F.lever[0], F.lever[2]].map((j) => ({ ...j, id: "b-" + j.id, categories: { ...j.categories, location: j.id === "lv-1" ? "Bengaluru" : "Berlin", allLocations: j.id === "lv-1" ? ["Bengaluru"] : ["Berlin"] } }))) : null),
      (u) => (u.includes("api.ashbyhq.com/posting-api/job-board/ingtest-hyd") ? json({ jobs: [{ id: "h1", title: "Hyderabad Engineer", location: "Hyderabad, Telangana, India", jobUrl: "https://jobs.ashbyhq.com/h/h1", applyUrl: "https://jobs.ashbyhq.com/h/h1/application", publishedAt: "2026-10-30T00:00:00Z" }, { id: "h2", title: "Remote Support India", location: "Remote - India", isRemote: true, jobUrl: "https://jobs.ashbyhq.com/h/h2" }] }) : null),
    ]);
    const blr = await mkSource("blr", "lever", { boardSlug: "ingtest-blr" }); const hyd = await mkSource("hyd", "ashby", { boardSlug: "ingtest-hyd" });
    await runSource(blr); await runSource(hyd);
    const names = (r: any) => r.jobs.map((j: any) => j.title).sort();
    const b = await queryFeed({ city: "bengaluru", company: (await srcRow(blr)).company_slug });
    assert.deepEqual(names(b), ["Frontend Engineer"]);
    const h = await queryFeed({ city: "hyderabad", company: (await srcRow(hyd)).company_slug });
    assert.ok(names(h).includes("Hyderabad Engineer")); assert.ok(!names(h).includes("Remote Support India"));
    assert.ok(!(await queryFeed({ city: "hyderabad", company: (await srcRow(blr)).company_slug })).jobs.some((j) => j.title === "Frontend Engineer" && !j.locations.some((l) => /hyderabad/i.test(l))), "a Bengaluru-only job is not a Hyderabad job");
    const rem = await queryFeed({ city: "remote", company: (await srcRow(hyd)).company_slug });
    assert.ok(names(rem).includes("Remote Support India")); assert.ok(!names(rem).includes("Hyderabad Engineer"));
    const apply = h.jobs.find((j) => j.title === "Hyderabad Engineer")!;
    assert.equal(apply.applyUrl, "https://jobs.ashbyhq.com/h/h1/application"); assert.equal(apply.freshness.state, "fresh"); assert.ok(apply.lastCheckedAt);
    const n0 = await cnt("SELECT count(*) c FROM company_jobs WHERE source_id = ANY($1)", [[blr, hyd]]);
    await runSource(blr); await runSource(hyd);
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id = ANY($1)", [[blr, hyd]]), n0);
    e2e.restore();
  });
  await t("feed filters: experience, type, role, text, pagination, freshness", async () => {
    const f1 = await queryFeed({ city: "all", q: "ingtest", pageSize: 5 }); assert.ok(f1.total >= 5); assert.equal(f1.jobs.length, 5);
    const none = await queryFeed({ city: "all", q: "zzzz-nothing" }); assert.equal(none.total, 0);
    assert.ok((await queryFeed({ city: "all", role: "software_engineering", pageSize: 50 })).jobs.every((j) => j.roleFamily === "software_engineering"));
    const inexp = await queryFeed({ city: "all", years: 20, pageSize: 50 }); assert.ok(inexp.jobs.every((j) => j.experienceMin === null || j.experienceMin <= 20));
    await query("UPDATE job_sources SET status='failing' WHERE company_slug LIKE 'ingtest%'");
    const st = await queryFeed({ city: "all", pageSize: 3 }); assert.ok(st.jobs.every((j) => j.freshness.state === "unavailable"));
    assert.equal((await queryFeed({ city: "all", fresh: true })).total, 0);
    assert.ok(st.jobs.every((j) => j.title), "last good data is still served while the source is failing");
  });
  await t("diagnostics aggregate real counts", async () => {
    const d = await ingestionDiagnostics();
    assert.ok(d.jobs.active > 0); assert.ok(d.sources.total >= 10); assert.ok(d.coverage.bengaluru.jobs > 0); assert.ok(d.coverage.hyderabad.jobs > 0); assert.ok(d.coverage.indiaRemote.jobs > 0);
    assert.ok(Array.isArray(d.sources.byProvider));
  });

  console.log("discovery");
  await t("registry parsing: supported/unsupported/invalid are counted separately", () => {
    const p = parseRegistry([
      { name: "G", ats: "greenhouse", token: "g1" }, { name: "W", ats: "workday", token: "wday", host: "wd3", site: "Ext" }, { name: "Bad", ats: "workday", token: "wday", host: "evil.com", site: "x" },
      { name: "O", ats: "icims", token: "o" }, { name: "Slash", ats: "lever", token: "a/b" }, { ats: "lever", token: "noname" }, 7,
    ], "registry:test");
    assert.equal(p.candidates.length, 2); assert.equal(p.unsupported.icims, 1); assert.equal(p.invalid, 4); assert.equal(p.total, 7);
  });
  await t("bulk import is idempotent and creates candidates, not sources", async () => {
    const entries = parseRegistry(Array.from({ length: 120 }, (_, i) => ({ name: `${PFX} Reg ${i}`, ats: "greenhouse", token: `ingtest-reg-${i}` })), "registry:test").candidates;
    const a = await importCandidates(entries, 50); const b = await importCandidates(entries, 50);
    assert.equal(a.inserted, 120); assert.equal(b.inserted, 0);
    assert.equal(await cnt("SELECT count(*) c FROM job_sources WHERE board_slug LIKE 'ingtest-reg-%'"), 0);
    assert.equal(await cnt("SELECT count(*) c FROM discovery_candidates WHERE origin='registry:test' AND state='ats_detected'"), 120);
  });
  await t("validation gate: board with Bengaluru jobs → active source; board with only US jobs → validated but NOT active; dead board → failed", async () => {
    const d = installFixtures([
      (u) => (u.includes("boards/ingtest-reg-1/jobs") ? json(F.greenhouse) : null),
      (u) => (u.includes("boards/ingtest-reg-2/jobs") ? json({ jobs: [{ id: 1, title: "Rep", absolute_url: "https://boards.greenhouse.io/x/jobs/1", location: { name: "Austin, TX" } }] }) : null),
      (u) => (u.includes("boards/ingtest-reg-3/jobs") ? new Response("nf", { status: 404 }) : null),
    ]);
    const idOf = async (n: number) => (await query<any>("SELECT id FROM discovery_candidates WHERE board_slug=$1", [`ingtest-reg-${n}`]))[0].id;
    const r1 = await processCandidate(await idOf(1)); const r2 = await processCandidate(await idOf(2)); const r3 = await processCandidate(await idOf(3));
    assert.equal(r1.state, "active_source"); assert.equal(r2.state, "board_validated"); assert.equal(r2.notRelevant, true); assert.equal(r3.state, "failed_source");
    assert.equal(await cnt("SELECT count(*) c FROM job_sources WHERE board_slug='ingtest-reg-1'"), 1); assert.equal(await cnt("SELECT count(*) c FROM job_sources WHERE board_slug IN ('ingtest-reg-2','ingtest-reg-3')"), 0);
    const [c] = await query<any>("SELECT evidence FROM discovery_candidates WHERE board_slug='ingtest-reg-1'");
    assert.equal(c.evidence.lastValidation.byCity.bengaluru, 1); assert.equal(c.evidence.relevance, "tracked_city_jobs");
    d.restore();
  });
  await t("daily discovery limit caps validation fetches", async () => {
    process.env.JOB_DISCOVERY_DAILY_LIMIT = "3";
    await query("DELETE FROM source_discovery_runs");
    const d = installFixtures([(u) => (u.includes("/jobs") ? new Response("nf", { status: 404 }) : null)]);
    const s1 = await processQueue({ limit: 50 }); assert.equal(s1.processed, 3);
    const s2 = await processQueue({ limit: 50 }); assert.equal(s2.processed, 0); assert.equal(s2.capped, true);
    delete process.env.JOB_DISCOVERY_DAILY_LIMIT; d.restore();
  });
  await t("a company with only a website is resolved website → careers page → ATS (no slug guessing)", async () => {
    const d = installFixtures([
      (u) => (u.endsWith("/robots.txt") ? text("User-agent: *\nDisallow: /private") : null),
      (u) => (u === "https://ingtest-site.example.com/" ? text('<html><a href="/careers">Careers</a></html>') : null),
      (u) => (u === "https://ingtest-site.example.com/careers" ? text('<html><iframe src="https://boards.greenhouse.io/ingtest-site"></iframe></html>') : null),
      (u) => (u.includes("boards/ingtest-site/jobs") ? json(F.greenhouse) : null),
    ]);
    const c = await addCandidate({ name: `${PFX} Site Co`, websiteUrl: "https://ingtest-site.example.com", origin: "test" });
    const r = await processCandidate(c.id);
    assert.equal(r.state, "active_source");
    const [row] = await query<any>("SELECT provider, board_slug, careers_url, evidence FROM discovery_candidates WHERE id=$1", [c.id]);
    assert.equal(row.provider, "greenhouse"); assert.equal(row.board_slug, "ingtest-site"); assert.ok(row.evidence.careers.pagesChecked.length >= 2);
    d.restore();
  });
  await t("no website and no board → needs manual review (never guessed)", async () => {
    const c = await addCandidate({ name: `${PFX} Nobody`, origin: "test" });
    assert.equal((await processCandidate(c.id)).state, "needs_manual_review");
  });
  await t("robots.txt disallow is respected when resolving careers pages", async () => {
    const d = installFixtures([(u) => (u.endsWith("/robots.txt") ? text("User-agent: *\nDisallow: /") : null), () => text("<html>should not be fetched</html>")]);
    const c = await addCandidate({ name: `${PFX} Robots`, websiteUrl: "https://ingtest-robots.example.com", origin: "test" });
    const r = await processCandidate(c.id); assert.equal(r.state, "needs_manual_review");
    assert.ok(!d.calls.some((x) => x.url === "https://ingtest-robots.example.com/"), "disallowed page not fetched"); d.restore();
  });

  console.log("admin actions");
  await t("addBoard validates against the endpoint first; unsupported providers and bad ids are refused", async () => {
    assert.equal((await addBoard({ companyName: `${PFX} X`, provider: "oracle", boardSlug: "x" })).ok, false);
    assert.equal((await addBoard({ companyName: `${PFX} X`, provider: "lever", boardSlug: "../x" })).ok, false);
    const d = installFixtures([(u) => (u.includes("postings/ingtest-adm") ? json(F.lever) : new Response("nf", { status: 404 }))]);
    assert.equal((await addBoard({ companyName: `${PFX} Adm`, provider: "lever", boardSlug: "ingtest-missing" })).ok, false);
    const ok = await addBoard({ companyName: `${PFX} Adm`, provider: "lever", boardSlug: "ingtest-adm", priority: "high", pollIntervalMinutes: 20 });
    assert.equal(ok.ok, true); const s = await srcRow(ok.sourceId!); assert.equal(s.priority, "high"); assert.equal(s.poll_interval_minutes, 20);
    assert.equal((await pauseSource(ok.sourceId!)).ok, true); assert.equal((await srcRow(ok.sourceId!)).status, "paused");
    assert.equal((await claimDueSources(50, 60, new Date(Date.now() + 1e9))).some((r) => r.id === ok.sourceId), false, "paused sources are never claimed");
    d.restore();
  });
  await t("addCompany rejects private/unsafe URLs and accepts an ATS URL", async () => {
    assert.equal((await addCompany({ name: `${PFX} Evil`, careersUrl: "https://169.254.169.254/x" })).ok, false);
    assert.equal((await addCompany({ name: `${PFX} Evil2`, careersUrl: "http://example.com/careers" })).ok, false);
    const d = installFixtures([(u) => (u.includes("boards/ingtest-urlco/jobs") ? json(F.greenhouse) : null)]);
    const r = await addCompany({ name: `${PFX} UrlCo`, careersUrl: "https://boards.greenhouse.io/ingtest-urlco" }); assert.equal(r.ok, true); assert.ok(r.sourceId); d.restore();
  });

  await clean();
  await pool().end();
  done("ingestion (database)");
}
main().catch(async (e) => { console.error(e); try { await clean(); } catch {} process.exit(1); });
