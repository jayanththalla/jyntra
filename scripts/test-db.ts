// Integration tests against a REAL PostgreSQL. Run with: DATABASE_URL=postgres://… npm run test:db
// Each run creates its own throw-away database (and drops it), so your data is never touched.
// Without DATABASE_URL the suite is skipped and says so; it does not pretend to have passed.
import assert from "node:assert/strict";
import { Client } from "pg";
import type { JobResult, StartupResult } from "@/lib/types";

const base = process.env.DATABASE_URL;
if (!base) {
  console.log("SKIPPED: DATABASE_URL is not set, so no database tests were run.");
  process.exit(0);
}

let passed = 0;
let failed = 0;
const failures: string[] = [];
async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 5).join("\n    ")}`);
  }
}

async function main() {
  const dbName = `jyntra_test_${process.pid}_${Date.now() % 100000}`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  admin.on("error", () => {}); // the server drops idle connections when the temp database is force-dropped
  await admin.query(`CREATE DATABASE ${dbName}`);
  const u = new URL(base!);
  u.pathname = "/" + dbName;
  process.env.DATABASE_URL = u.toString();

  const { query, pool, withTransaction } = await import("@/lib/database");
  const { upsertStartup } = await import("@/lib/discovery/store");
  const { loadAnalytics, AnalyticsUnavailableError } = await import("@/lib/analytics");
  const profile = (await import("../config/candidate_profile.json")).default as any;

  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const job = (o: Partial<JobResult> & { title: string; url: string }): JobResult => ({
    remote: "no", location: "Bengaluru", postedDate: today, skills: [], source: "company_careers", sourceUrl: "https://acme.dev/careers", ...o,
  });
  const startup = (o: Partial<StartupResult> & { jobs: JobResult[] }): StartupResult => ({
    name: "Acme", website: "https://acme.dev", source: "company_careers", sourceUrl: "https://acme.dev",
    funding: { date: today, amount: "$5M", round: "Seed", investors: [], source: "test", sourceUrl: "https://example.com/s" }, ...o,
  });
  const reset = () => query("TRUNCATE users, startups, discovery_runs, duplicate_candidates, funding_articles RESTART IDENTITY CASCADE");
  const count = async (sql: string, p: unknown[] = []) => Number((await query(sql, p))[0].c);

  console.log("ingestion: idempotency and identity");
  await t("repeating an import creates no duplicate startups or jobs", async () => {
    await reset();
    const r = startup({ jobs: [job({ title: "Backend Engineer", url: "https://acme.dev/jobs/1" }), job({ title: "Designer", url: "https://acme.dev/jobs/2" })] });
    await upsertStartup(r, profile);
    await upsertStartup(r, profile);
    await upsertStartup(r, profile);
    assert.equal(await count("SELECT count(*) c FROM startups"), 1);
    assert.equal(await count("SELECT count(*) c FROM jobs"), 2);
  });
  await t("URL variants (tracking params, casing, trailing slash, http) are one job", async () => {
    await reset();
    await upsertStartup(startup({ jobs: [job({ title: "Backend Engineer", url: "https://boards.greenhouse.io/acme/jobs/1?gh_src=abc" })] }), profile);
    await upsertStartup(startup({ jobs: [job({ title: "Backend Engineer", url: "http://Boards.Greenhouse.io/acme/jobs/1/?utm_source=li" })] }), profile);
    assert.equal(await count("SELECT count(*) c FROM jobs"), 1);
    assert.equal((await query("SELECT job_url FROM jobs"))[0].job_url, "https://boards.greenhouse.io/acme/jobs/1");
  });
  await t("a stable source id keeps the same job row when its URL changes (applications survive)", async () => {
    await reset();
    await upsertStartup(startup({ jobs: [job({ title: "Backend Engineer", url: "https://acme.dev/old/1", externalId: "greenhouse:acme:1" })] }), profile);
    const [j] = await query("SELECT id, startup_id FROM jobs");
    const [usr] = await query("INSERT INTO users(token, profile) VALUES ('tok-aaaaaaaaaaaaaaaaaaaa','{}') RETURNING id");
    await query("INSERT INTO applications(user_id, startup_id, job_id, status) VALUES ($1,$2,$3,'Saved')", [usr.id, j.startup_id, j.id]);
    await upsertStartup(startup({ jobs: [job({ title: "Backend Engineer (Platform)", url: "https://acme.dev/new/1", externalId: "greenhouse:acme:1" })] }), profile);
    const rows = await query("SELECT id, job_url, job_title FROM jobs");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, j.id, "same row id");
    assert.equal(rows[0].job_url, "https://acme.dev/new/1");
    assert.equal(await count("SELECT count(*) c FROM applications WHERE job_id = $1", [j.id]), 1, "application still linked");
  });
  await t("same source id from DIFFERENT sources are different jobs", async () => {
    await reset();
    await upsertStartup(startup({ source: "a", jobs: [job({ title: "Dev", url: "https://a.com/1", externalId: "1", source: "a", location: "Pune" })] }), profile);
    await upsertStartup(startup({ source: "b", jobs: [job({ title: "Designer", url: "https://b.com/1", externalId: "1", source: "b", location: "Delhi" })] }), profile);
    assert.equal(await count("SELECT count(*) c FROM jobs"), 2);
  });

  console.log("ingestion: cross-source matching (conservative)");
  await t("same title + same known location from two sources is kept once, and the match is logged", async () => {
    await reset();
    await upsertStartup(startup({ source: "company_careers", jobs: [job({ title: "Backend Engineer", url: "https://acme.dev/j/1", location: "Bengaluru" })] }), profile);
    await upsertStartup(startup({ source: "remotive", jobs: [job({ title: "backend engineer (Full-time)", url: "https://remotive.com/9", location: "bengaluru", source: "remotive" })] }), profile);
    assert.equal(await count("SELECT count(*) c FROM jobs"), 1);
    assert.equal(await count("SELECT count(*) c FROM duplicate_candidates WHERE kind = 'job'"), 1);
  });
  await t("same title but a different location is NOT merged", async () => {
    await reset();
    await upsertStartup(startup({ jobs: [job({ title: "Backend Engineer", url: "https://acme.dev/j/1", location: "Bengaluru" })] }), profile);
    await upsertStartup(startup({ source: "remotive", jobs: [job({ title: "Backend Engineer", url: "https://remotive.com/9", location: "Pune", source: "remotive" })] }), profile);
    assert.equal(await count("SELECT count(*) c FROM jobs"), 2);
  });
  await t("same title with an UNKNOWN location is not merged, only logged for review", async () => {
    await reset();
    await upsertStartup(startup({ jobs: [job({ title: "Backend Engineer", url: "https://acme.dev/j/1", location: "Bengaluru" })] }), profile);
    await upsertStartup(startup({ source: "remotive", jobs: [job({ title: "Backend Engineer", url: "https://remotive.com/9", location: null, source: "remotive" })] }), profile);
    assert.equal(await count("SELECT count(*) c FROM jobs"), 2);
    assert.equal(await count("SELECT count(*) c FROM duplicate_candidates"), 1);
  });
  await t("similar but different titles are never merged", async () => {
    await reset();
    await upsertStartup(startup({ jobs: [job({ title: "Backend Engineer", url: "https://acme.dev/j/1" }), job({ title: "Backend Engineering Manager", url: "https://acme.dev/j/2" }), job({ title: "Frontend Engineer", url: "https://acme.dev/j/3" })] }), profile);
    assert.equal(await count("SELECT count(*) c FROM jobs"), 3);
  });
  await t("two jobs without their own URL on one careers page stay distinct", async () => {
    await reset();
    await upsertStartup(startup({ jobs: [job({ title: "Dev A", url: "https://acme.dev/careers?job=aaaa", externalId: "jsonld:aaaa" }), job({ title: "Dev B", url: "https://acme.dev/careers?job=bbbb", externalId: "jsonld:bbbb" })] }), profile);
    assert.equal(await count("SELECT count(*) c FROM jobs"), 2);
  });

  console.log("ingestion: dates, lifecycle, startups");
  await t("an approximate date never creeps forward on refresh; an exact date overrides it", async () => {
    await reset();
    await upsertStartup(startup({ jobs: [job({ title: "Dev", url: "https://acme.dev/j/1", postedDate: "5 days ago" })] }), profile);
    const [first] = await query("SELECT posted_date::text d, posted_precision p FROM jobs");
    assert.equal(first.p, "approx");
    await upsertStartup(startup({ jobs: [job({ title: "Dev", url: "https://acme.dev/j/1", postedDate: "5 days ago" })] }), profile);
    assert.equal((await query("SELECT posted_date::text d FROM jobs"))[0].d, first.d, "unchanged by a refresh");
    await upsertStartup(startup({ jobs: [job({ title: "Dev", url: "https://acme.dev/j/1", postedDate: daysAgo(6) })] }), profile);
    const [after] = await query("SELECT posted_date::text d, posted_precision p FROM jobs");
    assert.equal(after.p, "exact");
    assert.equal(after.d, daysAgo(6));
  });
  await t("unknown dates stay NULL", async () => {
    await reset();
    await upsertStartup(startup({ jobs: [job({ title: "Dev", url: "https://acme.dev/j/1", postedDate: null })] }), profile);
    const [r] = await query("SELECT posted_date, posted_precision FROM jobs");
    assert.equal(r.posted_date, null);
    assert.equal(r.posted_precision, null);
  });
  await t("jobs that disappear are deactivated (not deleted) and reactivate with the same row", async () => {
    await reset();
    const a = job({ title: "Dev A", url: "https://acme.dev/j/1" });
    const b = job({ title: "Dev B", url: "https://acme.dev/j/2" });
    await upsertStartup(startup({ jobs: [a, b] }), profile);
    const idB = (await query("SELECT id FROM jobs WHERE job_title = 'Dev B'"))[0].id;
    await upsertStartup(startup({ jobs: [a] }), profile);
    assert.equal((await query("SELECT is_active FROM jobs WHERE id = $1", [idB]))[0].is_active, false);
    await upsertStartup(startup({ jobs: [a, b] }), profile);
    assert.equal((await query("SELECT is_active FROM jobs WHERE id = $1", [idB]))[0].is_active, true);
    assert.equal(await count("SELECT count(*) c FROM jobs"), 2);
  });
  await t("a PARTIAL provider read (jobsComplete:false) does not close postings it did not see; a complete read still does", async () => {
    await reset();
    const a = job({ title: "Dev A", url: "https://acme.dev/j/1" });
    const b = job({ title: "Dev B", url: "https://acme.dev/j/2" });
    await upsertStartup(startup({ jobs: [a, b] }), profile);
    await upsertStartup(startup({ jobs: [a], jobsComplete: false }), profile); // e.g. page 3 of the provider failed
    assert.equal(await count("SELECT count(*) c FROM jobs WHERE is_active"), 2, "nothing was closed by an incomplete read");
    await upsertStartup(startup({ jobs: [a] }), profile);
    assert.equal(await count("SELECT count(*) c FROM jobs WHERE is_active"), 1, "a complete read closes the missing posting");
  });
  await t("source health stores category and retry time on failure and clears them on success", async () => {
    const { recordSourceRun, describeSources } = await import("@/lib/refresh/health");
    await recordSourceRun("himalayas", { ok: false, error: "HTTP 429 https://himalayas.app/x?api_key=SECRET", category: "rate_limited", retryAfterSeconds: 600, durationMs: 5 });
    let h = await describeSources();
    const tech = h.technical.find((x) => x.provider === "himalayas")!;
    assert.equal(tech.error_category, "rate_limited"); assert.ok(tech.next_retry_at && Date.parse(tech.next_retry_at) - Date.now() > 590_000);
    assert.doesNotMatch(JSON.stringify(h), /SECRET|api_key/);
    assert.match(h.sources.find((x) => x.id === "himalayas")!.message!, /busy/);
    await recordSourceRun("himalayas", { ok: true, durationMs: 5 });
    h = await describeSources();
    assert.equal(h.technical.find((x) => x.provider === "himalayas")!.next_retry_at, null); assert.equal(h.sources.find((x) => x.id === "himalayas")!.message, null);
    assert.ok(h.technical.find((x) => x.provider === "himalayas")!.last_success_at);
  });
  await t("the same company by www/bare domain and http/https is one startup", async () => {
    await reset();
    await upsertStartup(startup({ website: "https://acme.dev", jobs: [] }), profile);
    await upsertStartup(startup({ name: "ACME Inc", website: "http://www.acme.dev/about", source: "yc", jobs: [] }), profile);
    assert.equal(await count("SELECT count(*) c FROM startups"), 1);
  });
  await t("eight concurrent identical imports leave exactly one startup and one job, with no errors", async () => {
    await reset();
    const r = startup({ jobs: [job({ title: "Backend Engineer", url: "https://acme.dev/j/1", externalId: "x:1" })] });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => upsertStartup(r, profile)));
    const rejected = results.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
    assert.equal(rejected.length, 0, rejected.map((x) => String(x.reason?.message)).join(" | "));
    assert.equal(await count("SELECT count(*) c FROM startups"), 1);
    assert.equal(await count("SELECT count(*) c FROM jobs"), 1);
  });

  console.log("company jobs: persist, preserve apply URLs, no delete on failure");
  await t("company jobs upsert by external id and keep a prior application URL", async () => {
    const { upsertCompanyProfile, persistCompanyJobs, markCompanyJobsStale, listJobsForSlug } = await import("@/lib/company-jobs/store");
    await query("TRUNCATE company_jobs, company_profiles, company_job_sync_runs RESTART IDENTITY CASCADE");
    await upsertCompanyProfile("pwc", "PwC");
    const job = {
      externalJobId: "abc", title: "Analyst", normalizedTitle: "Analyst", seniority: "associate", workMode: "hybrid" as const,
      employmentType: "Full-time", location: "Bengaluru", applicationUrl: "https://pwc.wd3.myworkdayjobs.com/job/abc",
      jobDetailUrl: null, postedAt: "2026-10-22T00:00:00.000Z", fresherFriendly: false, experienceMin: 2, experienceMax: null,
      salaryMin: null, salaryMax: null, salaryEstimated: false, description: "x", roleFamily: "consulting", source: "blrarena", companySlug: "pwc",
    };
    await persistCompanyJobs("pwc", [job], { complete: true, source: "blrarena" });
    await persistCompanyJobs("pwc", [{ ...job, applicationUrl: null, title: "Analyst II" }], { complete: true, source: "blrarena" });
    const rows = await listJobsForSlug("pwc");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].applicationUrl, "https://pwc.wd3.myworkdayjobs.com/job/abc");
    assert.equal(rows[0].title, "Analyst II");
    await markCompanyJobsStale("pwc");
    assert.equal(await count("SELECT count(*) c FROM company_jobs WHERE is_active"), 1);
    assert.equal((await query("SELECT is_stale FROM company_jobs"))[0].is_stale, true);
  });
  await t("an existing row without a link is updated when a valid link appears, and counted as recovered", async () => {
    const { upsertCompanyProfile, persistCompanyJobs, listJobsForSlug } = await import("@/lib/company-jobs/store");
    await query("TRUNCATE company_jobs, company_profiles, company_job_sync_runs RESTART IDENTITY CASCADE");
    await upsertCompanyProfile("pwc", "PwC");
    const job = {
      externalJobId: "r1", title: "Analyst", normalizedTitle: null, seniority: null, workMode: "unknown" as const, employmentType: null, location: null,
      applicationUrl: null as string | null, jobDetailUrl: null, postedAt: null, fresherFriendly: null, experienceMin: null, experienceMax: null,
      salaryMin: null, salaryMax: null, salaryEstimated: null, description: null, roleFamily: null, source: "blrarena", companySlug: "pwc",
    };
    const first = await persistCompanyJobs("pwc", [job], { complete: true, source: "blrarena" });
    assert.equal(first.recovered, 0);
    const url = "https://pwc.wd3.myworkdayjobs.com/CRM_Experienced_Careers_Site/job/Bengaluru/Analyst_R1";
    const second = await persistCompanyJobs("pwc", [{ ...job, applicationUrl: url }], { complete: true, source: "blrarena" });
    assert.equal(second.recovered, 1);
    assert.equal((await listJobsForSlug("pwc"))[0].applicationUrl, url);
    const third = await persistCompanyJobs("pwc", [job], { complete: true, source: "blrarena" }); // a later sync omits it
    assert.equal(third.recovered, 0);
    assert.equal((await listJobsForSlug("pwc"))[0].applicationUrl, url);
  });
  await t("on-demand recovery stores real links from the public endpoint (fetch stubbed with the PwC fixture)", async () => {
    const fs = await import("node:fs");
    const { persistCompanyJobs, listJobsForSlug, upsertCompanyProfile } = await import("@/lib/company-jobs/store");
    const { mapCompanyApiJobs } = await import("@/lib/company-jobs/adapter");
    const { recoverCompanyLinks } = await import("@/lib/company-jobs/sync");
    const fixture = JSON.parse(fs.readFileSync("scripts/fixtures/pwc-jobs.json", "utf8"));
    await query("TRUNCATE company_jobs, company_profiles, company_job_sync_runs RESTART IDENTITY CASCADE");
    await upsertCompanyProfile("pwc", "PwC");
    const bare = mapCompanyApiJobs(fixture.map((j: object) => ({ ...j, applyUrl: "" })), "pwc");
    assert.ok(!("error" in bare));
    await persistCompanyJobs("pwc", bare.jobs, { complete: true, source: "blrarena" });
    assert.equal((await listJobsForSlug("pwc")).filter((j) => j.applicationUrl).length, 0);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(fixture), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const rows = await recoverCompanyLinks("pwc");
      assert.equal(rows.length, 144);
      assert.equal(rows.filter((j) => j.applicationUrl && /pwc\.wd3\.myworkdayjobs\.com/.test(j.applicationUrl)).length, 144);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  await t("city boards: only jobs in the city are stored, with real apply links; closed jobs drop; failures keep stale jobs", async () => {
    const { syncBoards } = await import("@/lib/company-jobs/boards-sync");
    const { listJobsForSlug } = await import("@/lib/company-jobs/store");
    const { dbCompanyCards, loadDbCompany } = await import("@/lib/company-jobs/directory");
    await query("TRUNCATE company_jobs, company_profiles, company_job_sync_runs RESTART IDENTITY CASCADE");
    const rec = (id: string, location: string) => ({
      externalJobId: `greenhouse:acme:${id}`, title: `Engineer ${id}`, normalizedTitle: null, seniority: null, workMode: "unknown" as const, employmentType: null,
      location, applicationUrl: `https://boards.greenhouse.io/acme/jobs/${id}`, jobDetailUrl: `https://boards.greenhouse.io/acme/jobs/${id}`, postedAt: null,
      fresherFriendly: null, experienceMin: null, experienceMax: null, salaryMin: null, salaryMax: null, salaryEstimated: null, description: null, roleFamily: null,
      source: "ats:greenhouse", companySlug: "acme-labs",
    });
    const board = [{ name: "Acme Labs", ats: "greenhouse" as const, slug: "acme", city: "hyderabad", website: "https://acme.example" }];
    let feed = [rec("1", "Hyderabad, India"), rec("2", "Gachibowli, Hyderabad"), rec("3", "Bengaluru, India"), rec("4", "Remote")];
    const run1 = await syncBoards({ boards: board, fetcher: async () => feed });
    assert.equal(run1.stats.boardsOk, 1);
    assert.equal(run1.stats.jobsFetched, 2);
    let rows = await listJobsForSlug("acme-labs");
    assert.deepEqual(rows.map((r) => r.externalJobId).sort(), ["greenhouse:acme:1", "greenhouse:acme:2"]);
    assert.ok(rows.every((r) => r.applicationUrl?.startsWith("https://boards.greenhouse.io/acme/jobs/")));
    const cards = await dbCompanyCards(new Set());
    assert.equal(cards.length, 1);
    assert.equal(cards[0].city, "Hyderabad");
    assert.equal(cards[0].count, 2);
    assert.equal((await loadDbCompany("acme-labs"))!.jobs.length, 2);
    feed = [rec("1", "Hyderabad, India")]; // job 2 closed
    await syncBoards({ boards: board, fetcher: async () => feed });
    rows = await listJobsForSlug("acme-labs");
    assert.deepEqual(rows.map((r) => r.externalJobId), ["greenhouse:acme:1"]);
    const run3 = await syncBoards({ boards: board, fetcher: async () => { throw Object.assign(new Error("boom"), { status: 503 }); } });
    assert.equal(run3.stats.boardsOk, 0);
    rows = await listJobsForSlug("acme-labs");
    assert.equal(rows.length, 1); // a failed fetch does not close jobs
    assert.equal((await query("SELECT is_stale FROM company_jobs WHERE company_slug='acme-labs' AND is_active"))[0].is_stale, true);
    assert.equal((await loadDbCompany("acme-labs"))!.stale, true);
  });
  await t("company-job advisory lock refuses a second overlapping run", async () => {
    const { persistCompanyJobs, upsertCompanyProfile } = await import("@/lib/company-jobs/store");
    await query("TRUNCATE company_jobs, company_profiles RESTART IDENTITY CASCADE");
    await upsertCompanyProfile("lockco", "Lock Co");
    const row = {
      externalJobId: "j1", title: "Dev", normalizedTitle: null, seniority: null, workMode: "unknown" as const,
      employmentType: null, location: "Bengaluru", applicationUrl: "https://example.com/apply",
      jobDetailUrl: null, postedAt: null, fresherFriendly: null, experienceMin: null, experienceMax: null,
      salaryMin: null, salaryMax: null, salaryEstimated: null, description: null, roleFamily: null, source: "blrarena", companySlug: "lockco",
    };
    const results = await Promise.all([
      persistCompanyJobs("lockco", [row], { complete: true, source: "blrarena" }),
      persistCompanyJobs("lockco", [row], { complete: true, source: "blrarena" }),
    ]);
    assert.equal(await count("SELECT count(*) c FROM company_jobs WHERE company_slug='lockco'"), 1);
    assert.ok(results.every((r) => r.inserted + r.updated >= 1));
  });

  console.log("analytics: correctness against real data");
  const mkUser = async (tok: string) => (await query("INSERT INTO users(token, profile) VALUES ($1,'{}') RETURNING id", [tok.padEnd(20, "x")]))[0].id as number;
  const mkStartup = async (name: string, dom: string, fund: string | null) =>
    (await query("INSERT INTO startups(name, normalized_name, domain, source, last_funding_date) VALUES ($1,$1,$2,'t',$3) RETURNING id", [name, dom, fund]))[0].id as number;

  await t("empty database returns all zeros, nulls and empty objects (no errors)", async () => {
    await reset();
    const u1 = await mkUser("empty");
    const a = await loadAnalytics(u1);
    assert.deepEqual(a, { startups_total: 0, jobs_total: 0, saved_startups: 0, saved_jobs: 0, status_breakdown: {}, outreach_drafts: 0, outreach_sent: 0, outreach_logged_manually: 0, followups_due: 0, outreach_contacted: 0, outreach_replied: 0, outreach_positive: 0, outreach_meaningful: 0, funded_30: 0, funded_90: 0, funding_dated_total: 0, funding_undated_total: 0, funding_by_month: [], last_discovery_at: null });
  });
  await t("user-specific metrics are scoped to the user; shared totals are not", async () => {
    await reset();
    const [u1, u2] = [await mkUser("user1"), await mkUser("user2")];
    const s = await mkStartup("A", "a.com", null);
    await query("INSERT INTO applications(user_id, startup_id, status) VALUES ($1,$2,'Saved')", [u1, s]);
    await query("INSERT INTO outreach_messages(user_id, startup_id, body, status) VALUES ($1,$2,'x','sent')", [u1, s]);
    const a1 = await loadAnalytics(u1);
    const a2 = await loadAnalytics(u2);
    assert.equal(a1.saved_startups, 1);
    assert.equal(a1.outreach_sent, 1);
    assert.equal(a2.saved_startups, 0);
    assert.equal(a2.outreach_sent, 0);
    assert.deepEqual(a2.status_breakdown, {});
    assert.equal(a1.startups_total, 1);
    assert.equal(a2.startups_total, 1);
  });
  await t("outreach results count distinct companies and only outcomes the user recorded", async () => {
    await reset();
    const u = await mkUser("res");
    const [a, b, c, d] = [await mkStartup("A", "a.com", null), await mkStartup("B", "b.com", null), await mkStartup("C", "c.com", null), await mkStartup("D", "d.com", null)];
    // A: 3 messages and 2 applications (fan-out bait), replied + a call. B: positive reply. C: rejected (a reply, not positive). D: nothing recorded.
    for (let i = 0; i < 3; i++) await query("INSERT INTO outreach_messages(user_id, startup_id, body, status) VALUES ($1,$2,'m','sent')", [u, a]);
    for (const s of [b, c, d]) await query("INSERT INTO outreach_messages(user_id, startup_id, body, status) VALUES ($1,$2,'m','sent')", [u, s]);
    await query("INSERT INTO outreach_messages(user_id, startup_id, body, status) VALUES ($1,$2,'draft only','draft')", [u, (await mkStartup("E", "e.com", null))]);
    const j1 = (await query("INSERT INTO jobs(startup_id, job_title, job_url, source) VALUES ($1,'Dev','http://a/1','t') RETURNING id", [a]))[0].id;
    await query("INSERT INTO applications(user_id, startup_id, status, outcome) VALUES ($1,$2,'Applied','replied')", [u, a]);
    await query("INSERT INTO applications(user_id, startup_id, job_id, status, outcome) VALUES ($1,$2,$3,'Applied','interview_scheduled')", [u, a, j1]);
    await query("INSERT INTO applications(user_id, startup_id, status, outcome) VALUES ($1,$2,'Applied','replied')", [u, b]);
    await query("INSERT INTO applications(user_id, startup_id, status, outcome) VALUES ($1,$2,'Applied','rejected')", [u, c]);
    await query("INSERT INTO applications(user_id, startup_id, status, outcome) VALUES ($1,$2,'Applied','withdrawn')", [u, d]);
    const r = await loadAnalytics(u);
    assert.equal(r.outreach_contacted, 4, "drafts and repeated messages do not add companies");
    assert.equal(r.outreach_replied, 3, "A, B and C replied; withdrawing is not a reply");
    assert.equal(r.outreach_positive, 2, "a rejection is a reply but not a positive one");
    assert.equal(r.outreach_meaningful, 1, "only the interview counts");
  });
  await t("many messages and many applications for one startup are not double counted (no join fan-out)", async () => {
    await reset();
    const u = await mkUser("fan");
    const s = await mkStartup("A", "a.com", null);
    const j = (await query("INSERT INTO jobs(startup_id, job_title, job_url, source) VALUES ($1,'Dev','http://a/1','t') RETURNING id", [s]))[0].id;
    await query("INSERT INTO applications(user_id, startup_id, job_id, status, applied_at) VALUES ($1,$2,$3,'Applied', CURRENT_DATE - 10)", [u, s, j]);
    for (let i = 0; i < 5; i++) await query("INSERT INTO outreach_messages(user_id, startup_id, body, status, created_at) VALUES ($1,$2,'m','sent', now() - interval '20 days')", [u, s]);
    const a = await loadAnalytics(u);
    assert.equal(a.saved_jobs, 1);
    assert.equal(a.outreach_sent, 5);
    assert.equal(a.followups_due, 1, "one application is one follow-up, however many old messages exist");
    assert.equal(a.status_breakdown.Applied, 1);
  });
  await t("every application status is counted once under its own name", async () => {
    await reset();
    const u = await mkUser("status");
    for (const [i, st] of ["Saved", "Applied", "Interview", "Offer", "Rejected"].entries()) {
      const s = await mkStartup("S" + i, `s${i}.com`, null);
      await query("INSERT INTO applications(user_id, startup_id, status) VALUES ($1,$2,$3)", [u, s, st]);
    }
    assert.deepEqual((await loadAnalytics(u)).status_breakdown, { Saved: 1, Applied: 1, Interview: 1, Offer: 1, Rejected: 1 });
  });
  await t("follow-up date boundary: exactly 7 days ago is due, 6 days is not; a missing date is never due", async () => {
    await reset();
    const u = await mkUser("bound");
    const mk = async (n: string, applied: string | null) => {
      const s = await mkStartup(n, n + ".com", null);
      await query(`INSERT INTO applications(user_id, startup_id, status, applied_at) VALUES ($1,$2,'Applied', ${applied ?? "NULL"})`, [u, s]);
    };
    await mk("seven", "CURRENT_DATE - 7");
    await mk("six", "CURRENT_DATE - 6");
    await mk("future", "CURRENT_DATE + 3");
    await mk("nodate", null);
    assert.equal((await loadAnalytics(u)).followups_due, 1);
  });
  await t("follow-up: a recent SENT message clears it, a draft or an old message does not", async () => {
    await reset();
    const u = await mkUser("msgs");
    const mk = async (n: string, msgSql: string | null) => {
      const s = await mkStartup(n, n + ".com", null);
      await query("INSERT INTO applications(user_id, startup_id, status, applied_at) VALUES ($1,$2,'Applied', CURRENT_DATE - 14)", [u, s]);
      if (msgSql) await query(`INSERT INTO outreach_messages(user_id, startup_id, body, status, created_at) VALUES ($1,$2,'m',${msgSql})`, [u, s]);
    };
    await mk("recentsent", "'sent', now() - interval '2 days'");
    await mk("recentdraft", "'draft', now() - interval '2 days'");
    await mk("oldsent", "'sent', now() - interval '9 days'");
    await mk("nomsg", null);
    assert.equal((await loadAnalytics(u)).followups_due, 3);
  });
  await t("another user's messages never clear my follow-up", async () => {
    await reset();
    const [u1, u2] = [await mkUser("mine"), await mkUser("theirs")];
    const s = await mkStartup("A", "a.com", null);
    await query("INSERT INTO applications(user_id, startup_id, status, applied_at) VALUES ($1,$2,'Applied', CURRENT_DATE - 14)", [u1, s]);
    await query("INSERT INTO outreach_messages(user_id, startup_id, body, status) VALUES ($1,$2,'m','sent')", [u2, s]);
    assert.equal((await loadAnalytics(u1)).followups_due, 1);
  });
  await t("funding windows: boundaries inclusive, unknown dates excluded and reported separately", async () => {
    await reset();
    const u = await mkUser("fund");
    await mkStartup("d30", "d30.com", daysAgo(30));
    await mkStartup("d31", "d31.com", daysAgo(31));
    await mkStartup("d90", "d90.com", daysAgo(90));
    await mkStartup("d91", "d91.com", daysAgo(91));
    await mkStartup("today", "today.com", today);
    await mkStartup("none", "none.com", null);
    const a = await loadAnalytics(u);
    assert.equal(a.funded_30, 2, "today + exactly 30 days ago");
    assert.equal(a.funded_90, 4);
    assert.equal(a.funding_dated_total, 5);
    assert.equal(a.funding_undated_total, 1);
    assert.equal(a.startups_total, 6);
  });
  await t("inactive jobs are not counted", async () => {
    await reset();
    const u = await mkUser("jobs");
    const s = await mkStartup("A", "a.com", null);
    await query("INSERT INTO jobs(startup_id, job_title, job_url, source, is_active) VALUES ($1,'A','http://a/1','t',true),($1,'B','http://a/2','t',false)", [s]);
    assert.equal((await loadAnalytics(u)).jobs_total, 1);
  });
  await t("a database failure becomes a controlled error that contains no SQL or table names", async () => {
    await reset();
    const u = await mkUser("fail");
    await query("ALTER TABLE outreach_messages RENAME TO outreach_messages_x");
    try {
      await assert.rejects(() => loadAnalytics(u), (e: Error) => e instanceof AnalyticsUnavailableError && e.message === "analytics_unavailable" && !/outreach|relation|SELECT/i.test(e.message));
    } finally {
      await query("ALTER TABLE outreach_messages_x RENAME TO outreach_messages");
    }
    assert.equal((await loadAnalytics(u)).outreach_sent, 0, "recovers once the table is back");
  });
  await t("a read-only snapshot cannot write", async () => {
    await assert.rejects(() => withTransaction((q) => q("INSERT INTO sources(id, name, kind) VALUES ('zz','zz','x')"), { readOnly: true }));
  });

  console.log("funding news: storage, dedupe and honesty");
  const { upsertArticles, listArticles } = await import("@/lib/news/store");
  const art = (o: Partial<import("@/lib/news/store").ArticleInput> & { url: string; headline: string }) => ({ publisher: "inc42.com", provider: "rss" as const, publishedAt: new Date(Date.now() - 2 * 864e5).toISOString(), ...o });

  await t("re-importing the same article (even with tracking params) never duplicates it", async () => {
    await reset();
    await upsertArticles([art({ url: "https://inc42.com/a?utm_source=tw", headline: "Acme raises $5M in Series A" })]);
    const r = await upsertArticles([art({ url: "https://www.inc42.com/a/", headline: "Acme raises $5M in Series A" })]);
    assert.equal(await count("SELECT count(*) c FROM funding_articles"), 1);
    assert.equal(r.inserted, 0);
    assert.equal(r.updated, 1);
  });
  await t("a missing, invalid or future publication date is stored as NULL, never invented", async () => {
    await reset();
    await upsertArticles([
      art({ url: "https://a.com/1", headline: "One raises $1M seed", publishedAt: null }),
      art({ url: "https://a.com/2", headline: "Two raises $2M seed", publishedAt: "yesterday-ish" }),
      art({ url: "https://a.com/3", headline: "Three raises $3M seed", publishedAt: new Date(Date.now() + 30 * 864e5).toISOString() }),
      art({ url: "https://a.com/4", headline: "Four raises $4M seed", publishedAt: "1970-01-01" }),
    ]);
    assert.equal(await count("SELECT count(*) c FROM funding_articles WHERE published_at IS NULL"), 4);
    const { articles } = await listArticles({});
    assert.ok(articles.every((a) => a.freshness === "undated"));
  });
  await t("a later fetch fills in a date that was missing, but never overwrites a known one", async () => {
    await reset();
    await upsertArticles([art({ url: "https://a.com/1", headline: "One raises $1M seed", publishedAt: null })]);
    await upsertArticles([art({ url: "https://a.com/1", headline: "One raises $1M seed", publishedAt: "2026-09-01T00:00:00Z" })]);
    await upsertArticles([art({ url: "https://a.com/1", headline: "One raises $1M seed", publishedAt: "2026-10-01T00:00:00Z" })]);
    assert.equal((await query("SELECT published_at::date::text d FROM funding_articles"))[0].d, "2026-09-01");
  });
  await t("amount, round and currency come only from the headline; non-raise headlines get none", async () => {
    await reset();
    await upsertArticles([
      art({ url: "https://a.com/1", headline: "Acme raises $5M in Series A led by Foo" }),
      art({ url: "https://a.com/2", headline: "Beta bags ₹25 Cr in pre-Series A funding" }),
      art({ url: "https://a.com/3", headline: "Gamma launches a new payments product" }),
    ]);
    const rows = await query("SELECT headline, company_name, funding_amount, funding_currency, funding_round FROM funding_articles ORDER BY id");
    assert.equal(rows[0].funding_currency, "USD");
    assert.equal(rows[0].company_name, "Acme");
    assert.equal(rows[1].funding_currency, "INR");
    assert.equal(rows[2].funding_amount, null);
    assert.equal(rows[2].funding_currency, null);
    assert.equal(rows[2].funding_round, null);
    assert.equal(rows[2].company_name, null);
  });
  await t("the same raise reported by two outlets is stored once; two different companies are both kept", async () => {
    await reset();
    await upsertArticles([art({ url: "https://inc42.com/x", headline: "Acme raises $5M in Series A led by Foo Ventures" })]);
    const r = await upsertArticles([
      art({ url: "https://yourstory.com/y", publisher: "yourstory.com", headline: "Acme secures $5M Series A funding led by Foo Ventures" }),
      art({ url: "https://yourstory.com/z", publisher: "yourstory.com", headline: "Beta raises $5M in Series A led by Foo Ventures" }),
    ]);
    assert.equal(r.nearDuplicates, 1);
    assert.equal(await count("SELECT count(*) c FROM funding_articles"), 2);
    assert.equal(await count("SELECT count(*) c FROM duplicate_candidates WHERE kind = 'article'"), 1);
  });
  await t("an article is linked to a startup only when exactly one startup has that name", async () => {
    await reset();
    const { normalizeName } = await import("@/lib/deduplication");
    await query("INSERT INTO startups(name, normalized_name, domain, source) VALUES ('Acme',$1,'acme.dev','t'),('Dup',$2,'d1.com','t'),('Dup',$2,'d2.com','t')", [normalizeName("Acme"), normalizeName("Dup")]);
    await upsertArticles([
      art({ url: "https://a.com/1", headline: "Acme raises $5M in Series A" }),
      art({ url: "https://a.com/2", headline: "Dup raises $2M seed round" }),
      art({ url: "https://a.com/3", headline: "Nobody raises $1M seed round" }),
    ]);
    const rows = await query("SELECT company_name, startup_id FROM funding_articles ORDER BY id");
    assert.notEqual(rows[0].startup_id, null);
    assert.equal(rows[1].startup_id, null, "ambiguous name is not linked");
    assert.equal(rows[2].startup_id, null, "unknown company is not linked");
  });
  await t("listing: date window excludes undated stories, publisher filter works, LIKE wildcards are literal, paging is bounded", async () => {
    await reset();
    const items = Array.from({ length: 7 }, (_, i) => art({ url: `https://a.com/${i}`, headline: `Company${i} raises $${i + 1}M seed round`, publishedAt: new Date(Date.now() - i * 5 * 864e5).toISOString(), publisher: i % 2 ? "yourstory.com" : "inc42.com" }));
    items.push(art({ url: "https://a.com/undated", headline: "Undated raises $9M seed round", publishedAt: null }));
    items.push(art({ url: "https://a.com/pct", headline: "100% Co raises $9M seed round" }));
    await upsertArticles(items);
    assert.equal((await listArticles({})).total, 9);
    const w7 = await listArticles({ days: 7 });
    assert.ok(w7.articles.every((a) => a.published_at !== null), "undated excluded from a date window");
    assert.equal((await listArticles({ publisher: "yourstory.com" })).articles.every((a) => a.publisher === "yourstory.com"), true);
    assert.equal((await listArticles({ q: "%" })).total, 1, "a literal % only matches the '100%' headline");
    assert.equal((await listArticles({ q: "' OR 1=1 --" })).total, 0);
    assert.equal((await listArticles({ limit: 3, offset: 3 })).articles.length, 3);
    assert.equal((await listArticles({ limit: 9999 })).articles.length, 9, "limit is clamped");
    const first = (await listArticles({})).articles;
    assert.ok(first[0].published_at !== null, "dated stories sort before undated");
  });

  console.log("refresh: locking, health and failure handling");
  const { withAdvisoryLock } = await import("@/lib/refresh/lock");
  const { recordSourceRun, listSourceHealth } = await import("@/lib/refresh/health");
  await t("only one holder of the advisory lock at a time; it is released afterwards", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = withAdvisoryLock("test-lock", () => gate);
    await new Promise((r) => setTimeout(r, 150));
    const second = await withAdvisoryLock("test-lock", async () => "second");
    assert.equal(second.ran, false, "second caller is refused while the first holds the lock");
    release();
    assert.equal((await first).ran, true);
    const third = await withAdvisoryLock("test-lock", async () => "third");
    assert.equal(third.ran, true, "free again after release");
  });
  await t("the lock is released even if the work throws", async () => {
    await assert.rejects(() => withAdvisoryLock("test-lock-2", async () => { throw new Error("boom"); }), /boom/);
    assert.equal((await withAdvisoryLock("test-lock-2", async () => 1)).ran, true);
  });
  await t("source health: failures accumulate, a success resets them and keeps last_success_at", async () => {
    const get = async () => (await listSourceHealth()).find((x) => x.id === "funding_rss")!;
    await recordSourceRun("funding_rss", { ok: true, durationMs: 10, note: "5 articles" });
    const ok1 = await get();
    assert.equal(ok1.consecutive_failures, 0);
    assert.ok(ok1.last_success_at);
    await recordSourceRun("funding_rss", { ok: false, error: "HTTP 503", durationMs: 10 });
    await recordSourceRun("funding_rss", { ok: false, error: "HTTP 503", durationMs: 10 });
    const bad = await get();
    assert.equal(bad.consecutive_failures, 2);
    assert.equal(bad.last_error, "HTTP 503");
    assert.equal(new Date(bad.last_success_at!).getTime(), new Date(ok1.last_success_at!).getTime(), "last success is preserved");
    await recordSourceRun("funding_rss", { ok: true, durationMs: 10 });
    assert.equal((await get()).consecutive_failures, 0);
    assert.equal((await get()).last_error, null);
  });
  await t("credentials in an error message are scrubbed before being stored", async () => {
    await recordSourceRun("tavily", { ok: false, error: "GET https://x/?key=SUPERSECRET123&q=a failed token=abc", durationMs: 1 });
    const row = (await listSourceHealth()).find((x) => x.id === "tavily")!;
    assert.ok(!/SUPERSECRET123|token=abc/.test(row.last_error ?? ""), row.last_error ?? "");
  });
  await t("refreshNews with every feed unreachable reports the failure, records it, and keeps stored articles", async () => {
    await reset();
    await upsertArticles([art({ url: "https://a.com/keep", headline: "Keep raises $1M seed round" })]);
    const { refreshNews } = await import("@/lib/news/refresh");
    const r = await refreshNews();
    assert.equal(r.ran, true);
    if (r.ran) {
      const rss = r.report.providers.find((p) => p.id === "funding_rss")!;
      // In this sandbox the network is blocked, so all feeds fail; with network they would succeed. Either way it must not throw.
      if (!rss.ok) assert.match(rss.error ?? "", /all feeds failed/);
    }
    assert.equal(await count("SELECT count(*) c FROM funding_articles WHERE canonical_url LIKE '%a.com/keep%'"), 1, "existing data untouched");
  });

  console.log("routes: validation, auth and controlled errors");
  const { NextRequest } = await import("next/server");
  (globalThis as any).__newsKickAt = Date.now(); // stop the news route from starting a real background refresh
  const news = await import("@/app/api/news/route");
  const cron = await import("@/app/api/cron/refresh/route");
  const nreq = (qs: string) => new NextRequest(`http://localhost/api/news${qs}`, { headers: { "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  await t("/api/news rejects bad parameters with 400", async () => {
    for (const qs of ["?days=5", "?days=abc", "?page=0", "?page=9999", "?limit=1000", "?limit=-1", "?page=1.5"]) {
      const res = await news.GET(nreq(qs));
      assert.equal(res.status, 400, qs);
    }
  });
  await t("/api/news: 'empty' state when nothing is stored, with a labelled directory", async () => {
    await reset();
    await query("UPDATE sources SET consecutive_failures = 0 WHERE id = 'funding_rss'");
    const body = await (await news.GET(nreq(""))).json();
    assert.equal(body.state, "empty");
    assert.deepEqual(body.articles, []);
    assert.ok(Array.isArray(body.directory) && body.directory.length > 0);
  });
  await t("/api/news: 'unavailable' when nothing is stored and the feeds are failing", async () => {
    await reset();
    await recordSourceRun("funding_rss", { ok: false, error: "HTTP 503", durationMs: 1 });
    assert.equal((await (await news.GET(nreq(""))).json()).state, "unavailable");
  });
  await t("/api/news: stored articles are served with dates, freshness and provenance; no directory is shown", async () => {
    await reset();
    await upsertArticles([art({ url: "https://a.com/1", headline: "Acme raises $5M in Series A" })]);
    const body = await (await news.GET(nreq(""))).json();
    assert.equal(body.state, "ok");
    assert.equal(body.articles[0].freshness, "fresh");
    assert.ok(body.articles[0].last_checked_at && body.articles[0].first_ingested_at);
    assert.equal(body.directory, undefined);
  });
  await t("/api/news never leaks database details when the table is broken", async () => {
    await query("ALTER TABLE funding_articles RENAME TO funding_articles_x");
    try {
      const res = await news.GET(nreq(""));
      assert.equal(res.status, 503);
      const txt = JSON.stringify(await res.json());
      assert.ok(!/funding_articles|relation|SELECT/i.test(txt), txt);
    } finally {
      await query("ALTER TABLE funding_articles_x RENAME TO funding_articles");
    }
  });
  const creq = (h: Record<string, string>, qs = "", method = "POST") =>
    new Request(`http://localhost/api/cron/refresh${qs}`, { method, headers: { "x-forwarded-for": `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...h } });
  await t("/api/cron/refresh: 503 when unconfigured, 401 without/with a wrong secret, 405 for GET, 400 for a bad scope", async () => {
    delete process.env.CRON_SECRET;
    assert.equal((await cron.POST(creq({ authorization: "Bearer whatever-whatever-1234" }))).status, 503);
    process.env.CRON_SECRET = "0123456789abcdef-secret";
    assert.equal((await cron.POST(creq({}))).status, 401);
    assert.equal((await cron.POST(creq({ authorization: "Bearer nope-nope-nope-nope" }))).status, 401);
    assert.equal((await cron.GET()).status, 405);
    assert.equal((await cron.POST(creq({ authorization: "Bearer 0123456789abcdef-secret" }, "?scope=everything"))).status, 400);
  });
  await t("/api/cron/refresh?scope=news with the right secret runs and returns a per-provider report", async () => {
    const res = await cron.POST(creq({ authorization: "Bearer 0123456789abcdef-secret" }, "?scope=news"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.scope, "news");
    assert.ok(body.news.providers?.length >= 1 || body.news.skipped);
    assert.ok(!JSON.stringify(body).includes("0123456789abcdef-secret"), "the secret is never echoed");
  });

  console.log("outreach AI service: validation, verified context, failures (fake provider, nothing is sent)");
  const { generateForUser } = await import("@/lib/ai/service");
  const GOOD_AI = JSON.stringify({ subject: "Backend Engineer at Acme", body: "Hi, I build Python and PostgreSQL services and would love to help Acme with its backend. Could we talk this week?" });
  const mkFetch = (handler: (url: string, init: any) => Response) => {
    const calls: { url: string; body: any }[] = [];
    const f = (async (url: any, init: any) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return handler(String(url), init); }) as typeof fetch;
    return { f, calls };
  };
  const okGroq = () => new Response(JSON.stringify({ choices: [{ message: { content: GOOD_AI } }] }), { status: 200 });
  const seedForAi = async () => {
    await reset();
    const [u] = await query("INSERT INTO users(token, profile) VALUES ('ai-token-0123456789-abcdef', $1) RETURNING id, token, profile", [JSON.stringify({ ...profile, name: "Asha Rao", skills: ["Python", "PostgreSQL"], tech_experience_years: 4 })]);
    const user = { id: u.id, token: u.token, profile: u.profile } as any;
    await upsertStartup(startup({ name: "Acme", description: "Builds warehouse robots", jobs: [job({ title: "Backend Engineer", url: "https://acme.dev/j/1" }), job({ title: "Designer", url: "https://acme.dev/j/2" })] }), profile);
    await upsertStartup(startup({ name: "Other Co", website: "https://other.dev", jobs: [job({ title: "Other Role", url: "https://other.dev/j/1" })] }), profile);
    const acme = (await query("SELECT id FROM startups WHERE name = 'Acme'"))[0].id as number;
    const other = (await query("SELECT id FROM startups WHERE name = 'Other Co'"))[0].id as number;
    const jobs = await query("SELECT id, job_title, startup_id FROM jobs");
    return { user, acme, other, jobs };
  };
  await t("without any API key the service answers 'not_configured' (a normal state, HTTP 200), never an error", async () => {
    const { user, acme } = await seedForAi();
    const r = await generateForUser(user, { startup_id: acme, style: "founder_pitch" }, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.generated, false);
    assert.equal(r.body.code, "not_configured");
  });
  await t("invalid input is rejected with 400 before any provider call", async () => {
    const { user, acme } = await seedForAi();
    const { f, calls } = mkFetch(okGroq);
    const d = { groqKey: "k", fetchImpl: f };
    for (const bad of [null, [], "x", {}, { startup_id: "1", style: "founder_pitch" }, { startup_id: 0, style: "founder_pitch" }, { startup_id: 1.5, style: "founder_pitch" }, { startup_id: -3, style: "founder_pitch" },
      { startup_id: acme, style: "hack" }, { startup_id: acme }, { startup_id: acme, style: "founder_pitch", job_id: "7" }, { startup_id: acme, style: "founder_pitch", job_id: -1 }, { startup_id: acme, style: "founder_pitch", recipient_name: { a: 1 } }]) {
      const r = await generateForUser(user, bad, d);
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal(calls.length, 0);
  });
  await t("an unknown startup is 404", async () => {
    const { user } = await seedForAi();
    const { f, calls } = mkFetch(okGroq);
    assert.equal((await generateForUser(user, { startup_id: 999999, style: "founder_pitch" }, { groqKey: "k", fetchImpl: f })).status, 404);
    assert.equal(calls.length, 0);
  });
  await t("a jobId from ANOTHER startup is refused; a valid one is used in the prompt", async () => {
    const { user, acme, jobs } = await seedForAi();
    const foreign = jobs.find((j: any) => j.job_title === "Other Role")!;
    const designer = jobs.find((j: any) => j.job_title === "Designer")!;
    const { f, calls } = mkFetch(okGroq);
    const d = { groqKey: "k", fetchImpl: f };
    assert.equal((await generateForUser(user, { startup_id: acme, job_id: foreign.id, style: "founder_pitch" }, d)).status, 400);
    assert.equal(calls.length, 0);
    const ok = await generateForUser(user, { startup_id: acme, job_id: designer.id, style: "founder_pitch" }, d);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.job_id, designer.id);
    assert.match(calls[0].body.messages[0].content, /Role of interest: Designer/);
  });
  await t("the draft is built from DATABASE facts; extra fields a client sends are ignored", async () => {
    const { user, acme } = await seedForAi();
    const { f, calls } = mkFetch(okGroq);
    const r = await generateForUser(user, { startup_id: acme, style: "founder_pitch", startup_name: "EvilCorp", startup_description: "we cure cancer", funding_amount: "$9 billion", candidate_name: "Mallory" }, { groqKey: "k", fetchImpl: f });
    assert.equal(r.status, 200);
    const prompt = calls[0].body.messages[0].content as string;
    assert.match(prompt, /Name: Acme/);
    assert.match(prompt, /Builds warehouse robots/);
    assert.match(prompt, /Asha Rao/);
    assert.ok(!/EvilCorp|cure cancer|9 billion|Mallory/.test(prompt), "client-supplied facts must not reach the prompt");
  });
  await t("a recipient name is sanitised and length-capped", async () => {
    const { user, acme } = await seedForAi();
    const { f, calls } = mkFetch(okGroq);
    await generateForUser(user, { startup_id: acme, style: "follow_up", recipient_name: "Sam\u0000\n" + "x".repeat(500) }, { groqKey: "k", fetchImpl: f });
    const line = (calls[0].body.messages[0].content as string).split("\n").find((l) => l.startsWith("- Recipient:"))!;
    assert.ok(line.length < 120, String(line.length));
    assert.ok(!/\u0000/.test(line));
  });
  await t("success returns subject, body, provider; the key is never in the response", async () => {
    const { user, acme } = await seedForAi();
    const { f } = mkFetch(okGroq);
    const r = await generateForUser(user, { startup_id: acme, style: "founder_pitch" }, { groqKey: "SUPER_SECRET_KEY", fetchImpl: f });
    assert.equal(r.body.generated, true);
    assert.equal(r.body.provider, "groq");
    assert.ok(String(r.body.body).length > 20);
    assert.ok(!JSON.stringify(r.body).includes("SUPER_SECRET_KEY"));
  });
  await t("provider failures map to the right HTTP status and a safe, retry-aware message", async () => {
    const { user, acme } = await seedForAi();
    const cases: [number, number, string, boolean][] = [[429, 429, "rate_limited", true], [401, 503, "auth", false], [404, 503, "model_unavailable", false], [500, 502, "provider_error", true]];
    for (const [upstream, expected, code, retryable] of cases) {
      const { f } = mkFetch(() => new Response("UPSTREAM_SECRET_TEXT", { status: upstream }));
      const r = await generateForUser(user, { startup_id: acme, style: "founder_pitch" }, { groqKey: "K", fetchImpl: f });
      assert.equal(r.status, expected, `upstream ${upstream}`);
      assert.equal(r.body.code, code);
      assert.equal(r.body.retryable, retryable);
      assert.ok(!JSON.stringify(r.body).includes("UPSTREAM_SECRET_TEXT"));
    }
  });
  await t("another user's profile is never used: the draft uses the calling user's profile", async () => {
    const { acme } = await seedForAi();
    const [u2] = await query("INSERT INTO users(token, profile) VALUES ('ai-token-second-user-12345', $1) RETURNING id, token, profile", [JSON.stringify({ ...profile, name: "Second Person", skills: ["Rust"] })]);
    const { f, calls } = mkFetch(okGroq);
    await generateForUser({ id: u2.id, token: u2.token, profile: u2.profile } as any, { startup_id: acme, style: "founder_pitch" }, { groqKey: "k", fetchImpl: f });
    const prompt = calls[0].body.messages[0].content as string;
    assert.match(prompt, /Second Person/);
    assert.ok(!/Asha Rao/.test(prompt));
  });

  // The legacy send/log/draft tests were removed with the legacy service: the single draft service (lib/comms) is covered by
  // test-career-db.ts (send safety, idempotency, ownership) and test-workflow-db.ts (manual log, application linking).

  console.log("sessions and private links");
  await t("sessions: hash-only storage, sign-in, sign-out, private link replacement", async () => {
    await reset();
    const users = await import("@/lib/users");
    const { user, sessionToken } = await users.createUser(profile);
    const [row] = await query("SELECT token, link_token_hash FROM users WHERE id = $1", [user.id]);
    assert.equal(row.token, null, "no plain token stored");
    const sess = await query("SELECT token_hash FROM sessions WHERE user_id = $1", [user.id]);
    assert.equal(sess.length, 1);
    assert.equal(sess[0].token_hash, users.hashToken(sessionToken));
    assert.notEqual(sess[0].token_hash, sessionToken);
    assert.equal((await users.userBySession(sessionToken))?.id, user.id);
    assert.equal(await users.userBySession("x".repeat(30)), null);
    assert.equal(await users.userBySession(null), null);
    // private link
    assert.equal(await users.userByLinkToken("y".repeat(30)), null);
    const l1 = await users.newLinkToken(user.id);
    assert.equal((await users.userByLinkToken(l1))?.id, user.id);
    assert.equal(await users.userBySession(l1), null, "a link token is not a session");
    const l2 = await users.newLinkToken(user.id);
    assert.equal(await users.userByLinkToken(l1), null, "old link stops working");
    assert.equal((await users.userByLinkToken(l2))?.id, user.id);
    const [r2] = await query("SELECT link_token_hash, link_created_at FROM users WHERE id = $1", [user.id]);
    assert.equal(r2.link_token_hash, users.hashToken(l2));
    assert.ok(r2.link_created_at);
    // second device, then sign out only one
    const other = await users.createSession(user.id);
    await users.endSession(sessionToken);
    assert.equal(await users.userBySession(sessionToken), null, "signed-out session is dead");
    assert.equal((await users.userBySession(other))?.id, user.id, "other device stays signed in");
  });
  await t("migration: a legacy plain token becomes a hashed session and private link, then is erased", async () => {
    await reset();
    const users = await import("@/lib/users");
    const legacy = "legacy-token-" + "a".repeat(24);
    const [u] = await query("INSERT INTO users (token, profile) VALUES ($1, $2) RETURNING id", [legacy, JSON.stringify(profile)]);
    const sql = (await import("node:fs")).readFileSync("lib/database/schema.sql", "utf8");
    const start = sql.indexOf("-- Migration from plain tokens");
    assert.ok(start > 0, "migration block found");
    const block = sql.slice(start);
    await query(block);
    await query(block); // idempotent
    const [row] = await query("SELECT token, link_token_hash, link_created_at FROM users WHERE id = $1", [u.id]);
    assert.equal(row.token, null);
    assert.equal(row.link_token_hash, users.hashToken(legacy));
    assert.ok(row.link_created_at);
    assert.equal((await users.userBySession(legacy))?.id, u.id, "old cookie keeps working");
    assert.equal((await users.userByLinkToken(legacy))?.id, u.id, "old link keeps working");
    assert.equal(await count("SELECT count(*)::int c FROM sessions WHERE user_id = $1", [u.id]), 1);
  });

  pool().on("error", () => {});
  await pool().end();
  await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
  await admin.end();
  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED: ${failures.join("; ")}` : ""}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error("test-db crashed:", e);
  process.exit(2);
});
