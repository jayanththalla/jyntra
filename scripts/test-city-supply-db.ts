// Integration tests (real PostgreSQL via DATABASE_URL). ATS and GitHub traffic is served from fixtures; nothing touches the network.
import assert from "node:assert/strict";
import { pool, query, ready } from "@/lib/database";
import { runSource } from "@/lib/ingestion/runner";
import { ensureCompany, upsertSource } from "@/lib/ingestion/source-store";
import { queryFeed } from "@/lib/ingestion/feed";
import { addCandidate } from "@/lib/ingestion/discovery/candidates";
import { processCandidate } from "@/lib/ingestion/discovery/pipeline";
import { runInventoryDiscovery } from "@/lib/ingestion/discovery/inventory-run";
import { INVENTORY_RAW_BASE, INVENTORY_API_URL } from "@/lib/ingestion/discovery/ats-inventory";
import { syncCities } from "@/lib/ingestion/sync-cities";
import { reclassifyJobs } from "@/lib/ingestion/reclassify";
import { verifyApplyUrls } from "@/lib/ingestion/verify-urls";
import { buildIngestionReport } from "@/lib/ingestion/report";
import { harness, installFixtures, json } from "./ingestion-test-utils";

const { t, done } = harness();
const PFX = "cstest";
const cnt = async (sql: string, a: unknown[] = []) => Number((await query<{ c: string }>(sql, a))[0]!.c);
const clean = async () => {
  await query(`DELETE FROM discovery_candidates WHERE name LIKE '${PFX}%' OR origin LIKE 'ats-scrapers:%' OR origin = 'test'`);
  await query(`DELETE FROM company_profiles WHERE slug LIKE '${PFX}%'`);
  await query("DELETE FROM source_discovery_runs"); await query("DELETE FROM discovery_state WHERE key IN ('inventory_etags','inventory_last_run')");
};
const gh = (jobs: { id: number; title: string; loc: string; url?: string | null }[]) => ({ jobs: jobs.map((j) => ({ id: j.id, title: j.title, absolute_url: j.url === undefined ? `https://boards.greenhouse.io/x/jobs/${j.id}` : j.url, location: { name: j.loc }, updated_at: "2026-10-31T10:00:00Z", content: "" })), meta: { total: jobs.length } });
const mk = async (slug: string) => upsertSource({ id: null as any, companySlug: await ensureCompany(`${PFX} ${slug}`), provider: "greenhouse", boardSlug: `${PFX}-${slug}`, tenant: null, host: null, careerSite: null, sourceUrl: null, config: {} } as any);

async function main() {
  await ready(); await clean();
  let board: Record<string, any> = {};
  let down = new Set<string>();
  const fx = installFixtures([(u) => {
    const m = /boards\/(cstest-[a-z0-9-]+)\/jobs/.exec(u);
    if (m) { if (down.has(m[1]!)) return new Response("boom", { status: 500 }); return json(board[m[1]!] ?? { jobs: [] }); }
    return null;
  }]);

  console.log("migration");
  await t("new tables/columns exist; applying twice is a no-op", async () => {
    for (const [tbl, col] of [["source_validations", "status"], ["company_jobs", "cities"], ["company_jobs", "apply_url_status"], ["discovery_candidates", "priority"], ["ingestion_runs", "jobs_duplicates"]]) assert.equal(await cnt("SELECT count(*) c FROM information_schema.columns WHERE table_name=$1 AND column_name=$2", [tbl!, col!]), 1, `${tbl}.${col}`);
  });

  console.log("per-city ingestion (Bengaluru, Hyderabad, Chennai, India remote)");
  board[`${PFX}-a`] = gh([
    { id: 1, title: "Backend Engineer", loc: "Bengaluru, Karnataka, India" }, { id: 2, title: "Data Engineer", loc: "Hyderabad, Telangana, India" },
    { id: 3, title: "SRE", loc: "Chennai, Tamil Nadu, India" }, { id: 4, title: "Support", loc: "Remote - India" },
    { id: 5, title: "Platform", loc: "Bengaluru / Chennai" }, { id: 6, title: "AE", loc: "New York, NY" }, { id: 7, title: "No link", loc: "Chennai", url: null },
    { id: 2, title: "Data Engineer (dup id)", loc: "Hyderabad, Telangana, India" },
  ]);
  const A = await mk("a");
  await t("first sync stores per-city jobs; duplicate external ids in a payload are collapsed and counted", async () => {
    const r = await runSource(A);
    assert.equal(r.status, "success"); assert.equal(r.stats!.inserted, 7); assert.equal(r.stats!.duplicatesDropped, 1);
    assert.equal(await cnt("SELECT count(*) c FROM ingestion_runs WHERE source_id=$1 AND jobs_duplicates=1", [A]), 1);
  });
  const feed = (city: string) => queryFeed({ city, pageSize: 50 }).then((r) => r.jobs.filter((j) => j.company.slug.startsWith(PFX)));
  await t("Bengaluru, Hyderabad and Chennai feeds contain only jobs actually in that city", async () => {
    assert.deepEqual((await feed("bengaluru")).map((j) => j.title).sort(), ["Backend Engineer", "Platform"]);
    assert.deepEqual((await feed("hyderabad")).map((j) => j.title), ["Data Engineer (dup id)"]); // duplicate ids collapse, last record wins
    assert.deepEqual((await feed("chennai")).map((j) => j.title).sort(), ["No link", "Platform", "SRE"]);
  });
  await t("multi-location job keeps all real cities and appears in each city feed", async () => {
    const [j] = await query<any>("SELECT cities, locations, city_class FROM company_jobs WHERE source_id=$1 AND external_job_id='5'", [A]);
    assert.deepEqual([...j.cities].sort(), ["bengaluru", "chennai"]); assert.equal(j.city_class, "multi"); assert.equal(j.locations.length, 2);
  });
  await t("India-remote is separate: not shown as a Bengaluru/Hyderabad/Chennai onsite job", async () => {
    assert.deepEqual((await feed("remote")).map((j) => j.title), ["Support"]);
    for (const c of ["bengaluru", "hyderabad", "chennai"]) assert.ok(!(await feed(c)).some((j) => j.title === "Support"));
    assert.ok(!(await feed("target")).every((j) => j.title !== "Support"));
  });
  await t("US job is not in any tracked-city feed; missing application URL stays null, never invented", async () => {
    assert.ok(!(await feed("target")).some((j) => j.title === "AE"));
    const [j] = await query<any>("SELECT application_url FROM company_jobs WHERE source_id=$1 AND external_job_id='7'", [A]); assert.equal(j.application_url, null);
  });
  await t("re-sync is idempotent: no duplicates, first_seen preserved; later null URL never erases a stored one", async () => {
    const before = await query<any>("SELECT id, first_seen_at FROM company_jobs WHERE source_id=$1 ORDER BY id", [A]);
    board[`${PFX}-a`] = gh([{ id: 1, title: "Backend Engineer", loc: "Bengaluru, Karnataka, India", url: null }, ...[2, 3, 4, 5, 6, 7].map((id) => ({ id, title: `T${id}`, loc: "Chennai" }))]);
    const r = await runSource(A); assert.equal(r.stats!.inserted, 0);
    const after = await query<any>("SELECT id, first_seen_at, application_url FROM company_jobs WHERE source_id=$1 ORDER BY id", [A]);
    assert.deepEqual(after.map((x: any) => x.id), before.map((x: any) => x.id));
    assert.equal(after.find((x: any) => x.id === before[0].id).application_url, "https://boards.greenhouse.io/x/jobs/1");
  });

  console.log("failed-source preservation");
  await t("a failing source keeps every previous job active (flagged stale), closes nothing, and records the failure", async () => {
    const act = await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_active", [A]);
    down.add(`${PFX}-a`);
    const r = await runSource(A); assert.equal(r.status, "failed");
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_active", [A]), act);
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_stale", [A]), act);
    const [s] = await query<any>("SELECT consecutive_failures, last_error_category FROM job_sources WHERE id=$1", [A]); assert.equal(s.consecutive_failures, 1); assert.equal(s.last_error_category, "server_error");
    down.delete(`${PFX}-a`);
  });
  await t("jobs close only after a successful COMPLETE fetch that no longer lists them", async () => {
    board[`${PFX}-a`] = gh([{ id: 1, title: "Backend Engineer", loc: "Bengaluru, India" }]);
    const r = await runSource(A); assert.equal(r.stats!.closed, 6);
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND is_active", [A]), 1);
  });

  console.log("reclassification (classifier change)");
  await t("jobs:reclassify fixes stored rows from their own locations without network; dry-run writes nothing", async () => {
    await query("UPDATE company_jobs SET city_class='other_india', cities='{}', locations=ARRAY['Chennai, Tamil Nadu, India'] WHERE source_id=$1 AND external_job_id='1'", [A]);
    const dry = await reclassifyJobs({ dryRun: true }); assert.ok(dry.changed >= 1);
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs WHERE source_id=$1 AND city_class='other_india'", [A]), 1);
    await reclassifyJobs();
    const [j] = await query<any>("SELECT city_class, cities FROM company_jobs WHERE source_id=$1 AND external_job_id='1'", [A]); assert.equal(j.city_class, "chennai"); assert.deepEqual(j.cities, ["chennai"]);
  });

  console.log("validation → registration");
  const cand = async (slug: string) => (await addCandidate({ name: `${PFX} cand ${slug}`, provider: "greenhouse", boardSlug: `${PFX}-${slug}`, origin: "test" })).id;
  board[`${PFX}-chn`] = gh([{ id: 1, title: "Chennai only", loc: "Chennai, India" }]);
  board[`${PFX}-pune`] = gh([{ id: 1, title: "Pune role", loc: "Pune, Maharashtra, India" }]);
  board[`${PFX}-us`] = gh([{ id: 1, title: "US role", loc: "Austin, TX" }]);
  board[`${PFX}-empty`] = { jobs: [] };
  await t("board with only Chennai jobs becomes an active source (Chennai is a tracked city)", async () => {
    const r = await processCandidate(await cand("chn")); assert.equal(r.state, "active_source");
    assert.equal(await cnt("SELECT count(*) c FROM source_validations WHERE status='valid_with_jobs' AND board_ref=$1 AND city_counts->>'city:chennai'='1'", [`${PFX}-chn`]), 1);
  });
  await t("India-relevant board with zero jobs in any tracked city is STILL registered (it may hire there next week)", async () => {
    const r = await processCandidate(await cand("pune")); assert.equal(r.state, "active_source");
  });
  await t("board with no India jobs is validated but not registered; empty board is valid_no_jobs; both rechecked later", async () => {
    assert.equal((await processCandidate(await cand("us"))).state, "board_validated");
    assert.equal((await processCandidate(await cand("empty"))).state, "board_validated");
    assert.equal(await cnt("SELECT count(*) c FROM source_validations WHERE status='valid_no_jobs' AND board_ref=$1", [`${PFX}-empty`]), 1);
    assert.equal(await cnt("SELECT count(*) c FROM job_sources WHERE board_slug=$1", [`${PFX}-us`]), 0);
  });
  await t("a 404 board is not_found; a 500 board is temporarily_unavailable (never not_found)", async () => {
    const dead = await cand("dead"); const flaky = await cand("flaky"); down.add(`${PFX}-flaky`);
    // unknown boards 404 through the fixture's default
    const handler404 = installFixtures([(u) => (u.includes(`${PFX}-dead/`) ? new Response("nope", { status: 404 }) : u.includes(`${PFX}-flaky/`) ? new Response("boom", { status: 500 }) : null)]);
    await processCandidate(dead); await processCandidate(flaky); handler404.restore();
    assert.equal(await cnt("SELECT count(*) c FROM source_validations WHERE status='not_found' AND board_ref=$1", [`${PFX}-dead`]), 1);
    assert.equal(await cnt("SELECT count(*) c FROM source_validations WHERE status='temporarily_unavailable' AND board_ref=$1", [`${PFX}-flaky`]), 1);
    assert.equal(await cnt("SELECT count(*) c FROM source_validations WHERE status='not_found' AND board_ref=$1", [`${PFX}-flaky`]), 0);
    down.delete(`${PFX}-flaky`);
  });

  console.log("sync-cities");
  await t("--dry-run reads live sources and reports per-city counts but writes nothing", async () => {
    const jobsBefore = await cnt("SELECT count(*) c FROM company_jobs"); const runsBefore = await cnt("SELECT count(*) c FROM ingestion_runs");
    const rep = await syncCities({ dryRun: true, city: "chennai", concurrency: 2 });
    assert.equal(rep.dryRun, true); assert.equal(rep.perCity.chennai.jobs, 1); assert.equal(rep.perCity.chennai.sample[0]!.title, "Chennai only"); assert.ok(rep.perProvider.greenhouse!.sources >= 3);
    assert.equal(await cnt("SELECT count(*) c FROM company_jobs"), jobsBefore); assert.equal(await cnt("SELECT count(*) c FROM ingestion_runs"), runsBefore);
  });
  await t("real run syncs every board (no city-specific board needed) and per-city numbers come from the database", async () => {
    const rep = await syncCities({ city: "all", concurrency: 2 });
    assert.ok(rep.sources.loaded >= 3); assert.equal(rep.sources.failed, 0);
    const dbChennai = await cnt("SELECT count(*) c FROM company_jobs WHERE is_active AND source_id IS NOT NULL AND 'chennai' = ANY(cities)");
    assert.equal(rep.perCity.chennai.jobs, dbChennai); assert.ok(rep.perCity.chennai.sample.length > 0);
    assert.equal(await cnt("SELECT count(*) c FROM job_sources WHERE locked_until IS NOT NULL AND board_slug LIKE $1", [`${PFX}%`]), 0); // leases released
  });

  console.log("application-link verification");
  await t("probe records ok/gone/restricted and never edits application_url or closes jobs", async () => {
    await query("UPDATE company_jobs SET apply_url_checked_at=NULL WHERE source_id IS NOT NULL");
    const before = await query<any>("SELECT id, application_url, is_active FROM company_jobs WHERE source_id IS NOT NULL AND application_url IS NOT NULL ORDER BY id");
    const px = installFixtures([(u, init) => { const id = Number(/jobs\/(\d+)/.exec(u)?.[1] ?? 0); if (!/greenhouse\.io\/x\/jobs/.test(u)) return null; return new Response(null, { status: id === 1 ? 200 : 404 }); }]);
    const r = await verifyApplyUrls({ limit: 100 }); px.restore();
    assert.ok(r.checked > 0); assert.ok((r.byStatus.ok ?? 0) >= 1);
    const after = await query<any>("SELECT id, application_url, is_active FROM company_jobs WHERE source_id IS NOT NULL AND application_url IS NOT NULL ORDER BY id");
    assert.deepEqual(after, before);
  });

  console.log("inventory import");
  await t("inventory import is idempotent, honours --limit/dry-run, and stores platform priority", async () => {
    const csv: Record<string, string> = { "keka.csv": "name,url\nCstest Keka,https://cstestkeka.keka.com/careers\n", "greenhouse.csv": "name,slug,url\nCstest GH,cstest-ghx,https://job-boards.greenhouse.io/cstest-ghx\n" };
    const f = installFixtures([(u, init) => {
      if (u === INVENTORY_API_URL) return json(Object.keys(csv).map((n) => ({ type: "file", name: n })));
      if (u.startsWith(INVENTORY_RAW_BASE) && (init.headers as any)?.["If-None-Match"] === "v1") return new Response(null, { status: 304, headers: { etag: "v1" } });
      if (u.startsWith(INVENTORY_RAW_BASE)) return new Response(csv[decodeURIComponent(u.slice(INVENTORY_RAW_BASE.length))] ?? "", { status: 200, headers: { etag: "v1" } });
      return null;
    }]);
    try {
      const dry = await runInventoryDiscovery({ dryRun: true }); assert.equal(dry.selected, 2); assert.equal(await cnt("SELECT count(*) c FROM discovery_candidates WHERE origin LIKE 'ats-scrapers:%'"), 0);
      const one = await runInventoryDiscovery({ limit: 1 }); assert.equal(one.inserted, 1);
      const all = await runInventoryDiscovery({}); assert.equal(all.inserted, 1); assert.equal(all.alreadyKnown, 1);
      const again = await runInventoryDiscovery({}); assert.equal(again.inserted, 0); assert.equal(again.filesNotModified, 2); // ETag-incremental after a complete import
      const [k] = await query<any>("SELECT priority, state, origin FROM discovery_candidates WHERE provider='keka' AND board_slug='cstestkeka'"); assert.equal(k.priority, 10); assert.equal(k.state, "ats_detected"); assert.equal(k.origin, "ats-scrapers:keka");
    } finally { f.restore(); }
  });

  console.log("report");
  await t("every report number equals what the database says", async () => {
    const r = await buildIngestionReport();
    for (const c of ["bengaluru", "hyderabad", "chennai"] as const) {
      assert.equal(r.cities[c].activeJobs, await cnt("SELECT count(*) c FROM company_jobs WHERE is_active AND source_id IS NOT NULL AND $1 = ANY(cities)", [c]));
      assert.equal(r.cities[c].jobsMissingApplicationUrl, await cnt("SELECT count(*) c FROM company_jobs WHERE is_active AND source_id IS NOT NULL AND $1 = ANY(cities) AND application_url IS NULL", [c]));
    }
    assert.equal(r.cities.indiaRemote.activeJobs, await cnt("SELECT count(*) c FROM company_jobs WHERE is_active AND source_id IS NOT NULL AND city_class='india_remote'"));
    assert.equal(r.discovery.candidatesDiscovered, await cnt("SELECT count(*) c FROM discovery_candidates"));
    assert.ok(r.discovery.boardsValidated >= 4); assert.ok(r.discovery.boardsRejected >= 1); assert.ok(r.discovery.boardsTemporarilyUnavailable >= 1);
    assert.ok(r.duplicates.duplicateRecordsDroppedFromPayloads >= 1);
  });

  fx.restore(); await clean(); await pool().end();
  done("city supply chain (database)");
}
main().catch((e) => { console.error(e); process.exit(1); });
