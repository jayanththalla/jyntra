// Pure tests for the ingestion engine (no database, no network): classification, normalisation, every provider's parsing
// and pagination against fixtures, the HTTP layer's failure handling, and ATS detection.
import assert from "node:assert/strict";
import { classifyLocation, splitLocations } from "@/lib/ingestion/location";
import { contentHashOf, finalizeJob, parseExperience, toIso } from "@/lib/ingestion/normalize";
import { backoffSeconds, httpJson, httpRequest, parseRetryAfter } from "@/lib/ingestion/http";
import { getProvider, NOT_IMPLEMENTED, PROVIDER_IDS, PROVIDER_META } from "@/lib/ingestion/providers";
import { detectAts } from "@/lib/ingestion/providers/detect";
import { parsePostedOn } from "@/lib/ingestion/providers/workday";
import { personioYears } from "@/lib/ingestion/providers/personio";
import { roleFamily } from "@/lib/ingestion/role";
import { hostKeyOf } from "@/lib/ingestion/scheduler";
import { KeyedLimiter } from "@/lib/ingestion/limiter";
import { IngestError, type JobSource, type ProviderId } from "@/lib/ingestion/types";
import * as F from "./fixtures/ingestion/payloads";
import { harness, installFixtures, json, text } from "./ingestion-test-utils";

const { t, done } = harness();
const src = (provider: ProviderId, over: Partial<JobSource> = {}): JobSource => ({ id: 1, companySlug: "acme", provider, boardSlug: "acme", tenant: null, host: null, careerSite: null, sourceUrl: null, etag: null, lastModified: null, config: {}, ...over });
const byId = <T extends { externalJobId: string }>(jobs: T[], id: string) => jobs.find((j) => j.externalJobId === id)!;

async function main() {
  console.log("location classification (per job, never per company)");
  const cls = (...l: string[]) => classifyLocation(splitLocations(l)).cityClass;
  await t("Bengaluru variants", () => { for (const v of ["Bengaluru", "Bangalore", "Bengaluru Urban", "Bangalore, Karnataka, India", "BLR", "Whitefield, Bengaluru"]) assert.equal(cls(v), "bengaluru", v); });
  await t("Hyderabad variants", () => { for (const v of ["Hyderabad", "Hyderabad, Telangana", "HYD", "Secunderabad, India", "Hyderabad, Telangana, India"]) assert.equal(cls(v), "hyderabad", v); });
  await t("both only when both are explicitly listed", () => { assert.equal(cls("Bengaluru / Hyderabad"), "both"); assert.equal(cls("Bangalore, Hyderabad"), "both"); assert.equal(cls("Bengaluru"), "bengaluru"); });
  await t("a Bengaluru-only job is never Hyderabad", () => { const c = classifyLocation(splitLocations(["Bengaluru, India"])); assert.deepEqual(c.cities, ["bengaluru"]); });
  await t("Hyderabad, Pakistan is not India", () => assert.equal(cls("Hyderabad, Sindh, Pakistan"), "unknown"));
  await t("India remote needs an India signal; bare Remote does not qualify", () => {
    assert.equal(classifyLocation(splitLocations(["Remote - India"])).cityClass, "india_remote");
    assert.equal(classifyLocation(splitLocations(["India (Remote)"])).remoteIndia, true);
    const bare = classifyLocation(splitLocations(["Remote"]));
    assert.equal(bare.cityClass, "unknown"); assert.equal(bare.remoteIndia, false);
    assert.equal(classifyLocation(splitLocations(["Remote, United States"])).remoteIndia, false);
  });
  await t("provider remote flag + India location = India remote", () => assert.equal(classifyLocation(["India"], "remote").cityClass, "india_remote"));
  await t("remote role tied to a city stays in that city", () => { const c = classifyLocation(splitLocations(["Remote - Bengaluru"])); assert.equal(c.cityClass, "bengaluru"); assert.equal(c.remoteIndia, true); });
  await t("other Indian cities and unknowns", () => { assert.equal(cls("Pune, India"), "other_india"); assert.equal(cls("Mumbai"), "other_india"); assert.equal(cls("London, UK"), "unknown"); assert.equal(cls(), "unknown"); });
  await t("multi-location strings are split without breaking City, State, Country", () => assert.deepEqual(splitLocations(["Bengaluru, Karnataka, India / Hyderabad; Pune | Remote"]), ["Bengaluru, Karnataka, India", "Hyderabad", "Pune", "Remote"]));
  await t("Indianapolis, IN is not India", () => assert.equal(cls("Indianapolis, IN"), "unknown"));

  console.log("normalisation");
  await t("toIso accepts ISO / epoch / Recruitee format; rejects future and ancient dates", () => {
    assert.equal(toIso("2026-10-21 13:16:05 UTC"), "2026-10-21T13:16:05.000Z");
    assert.equal(toIso(1761000000000), new Date(1761000000000).toISOString());
    assert.equal(toIso(1761000000), toIso(1761000000000));
    assert.equal(toIso("1999-01-01"), null);
    assert.equal(toIso("2099-01-01"), null);
    assert.equal(toIso("garbage"), null); assert.equal(toIso(null), null);
  });
  await t("parseExperience", () => {
    assert.deepEqual(parseExperience("5-8 years of experience"), { min: 5, max: 8 });
    assert.deepEqual(parseExperience("3+ years"), { min: 3, max: null });
    assert.deepEqual(parseExperience("minimum 4 years"), { min: 4, max: null });
    assert.deepEqual(parseExperience("we are 12 years old"), { min: null, max: null });
    assert.deepEqual(parseExperience(""), { min: null, max: null });
  });
  await t("apply URL: unsafe/invalid is dropped to null, never replaced by the board page", () => {
    for (const bad of ["javascript:alert(1)", "http://insecure.example.com/x", "not a url", "https://user:pw@x.com/a", ""]) {
      const j = finalizeJob("acme", "lever", "https://jobs.lever.co/acme", { externalJobId: "1", title: "T", applyUrl: bad })!;
      assert.equal(j.applyUrl, null, bad);
    }
    const ok = finalizeJob("acme", "lever", "https://jobs.lever.co/acme", { externalJobId: "1", title: "T", applyUrl: "https://jobs.lever.co/acme/1/apply" })!;
    assert.equal(ok.applyUrl, "https://jobs.lever.co/acme/1/apply");
  });
  await t("records without id or title are skipped", () => { assert.equal(finalizeJob("a", "lever", "https://x.com", { externalJobId: "", title: "T" }), null); assert.equal(finalizeJob("a", "lever", "https://x.com", { externalJobId: "1", title: " " }), null); });
  await t("content hash is stable and sensitive to content", () => {
    const a = finalizeJob("a", "lever", "https://x.com", { externalJobId: "1", title: "T", locationTexts: ["Bengaluru"], applyUrl: "https://x.com/a" })!;
    const b = finalizeJob("a", "lever", "https://x.com", { externalJobId: "1", title: "T", locationTexts: ["Bengaluru"], applyUrl: "https://x.com/a" })!;
    const c = finalizeJob("a", "lever", "https://x.com", { externalJobId: "1", title: "T2", locationTexts: ["Bengaluru"], applyUrl: "https://x.com/a" })!;
    assert.equal(a.contentHash, b.contentHash); assert.notEqual(a.contentHash, c.contentHash); assert.equal(a.contentHash, contentHashOf(a));
  });
  await t("role family", () => { assert.equal(roleFamily("Senior Backend Engineer"), "software_engineering"); assert.equal(roleFamily("Data Scientist"), "data_ml"); assert.equal(roleFamily("Account Executive"), "sales"); assert.equal(roleFamily("Chief of Staff"), "other"); });

  console.log("providers (fixtures)");
  const gh = installFixtures([(u) => (u.includes("boards-api.greenhouse.io/v1/boards/acme/jobs") ? json(F.greenhouse, { etag: 'W/"abc"' }) : null)]);
  await t("greenhouse: fields, classes, skip, dates", async () => {
    const r = await getProvider("greenhouse").fetchJobs(src("greenhouse"));
    assert.equal(r.jobs.length, 5); assert.equal(r.skipped, 1); assert.equal(r.complete, true); assert.equal(r.etag, 'W/"abc"');
    assert.equal(byId(r.jobs, "4001").cityClass, "bengaluru"); assert.equal(byId(r.jobs, "4002").cityClass, "hyderabad");
    assert.equal(byId(r.jobs, "4003").cityClass, "unknown"); assert.equal(byId(r.jobs, "4004").cityClass, "both"); assert.equal(byId(r.jobs, "4005").cityClass, "india_remote");
    assert.equal(byId(r.jobs, "4001").applyUrl, "https://boards.greenhouse.io/acme/jobs/4001");
    assert.equal(byId(r.jobs, "4001").postedAt, "2026-10-20T13:00:00.000Z");
    assert.equal(byId(r.jobs, "4002").postedAt, null, "updated_at must NOT become the posted date");
    assert.match(byId(r.jobs, "4001").description ?? "", /Build services/); assert.equal(byId(r.jobs, "4001").experienceMin, 5);
  });
  await t("greenhouse: validation returns evidence", async () => { const v = await getProvider("greenhouse").validateSource(src("greenhouse")); assert.ok(v.ok); assert.equal(v.jobCount, 5); assert.equal(v.sample.length, 3); });
  await t("greenhouse: sends If-None-Match when an etag is stored", async () => {
    gh.calls.length = 0;
    await getProvider("greenhouse").fetchJobs(src("greenhouse", { etag: 'W/"abc"' }));
    assert.equal(gh.calls[0]!.headers["If-None-Match"], 'W/"abc"');
  });
  gh.restore();

  const lv = installFixtures([(u) => (u.includes("api.lever.co/v0/postings/acme") ? json(F.lever) : null)]);
  await t("lever: locations, remote, salary, apply fallback", async () => {
    const r = await getProvider("lever").fetchJobs(src("lever"));
    assert.equal(r.jobs.length, 3);
    const a = byId(r.jobs, "lv-1"); assert.equal(a.cityClass, "both"); assert.equal(a.workplaceType, "hybrid"); assert.equal(a.salaryMin, 2000000); assert.equal(a.salaryCurrency, "INR"); assert.equal(a.applyUrl, "https://jobs.lever.co/acme/lv-1/apply"); assert.equal(a.experienceMin, 3);
    const b = byId(r.jobs, "lv-2"); assert.equal(b.cityClass, "india_remote"); assert.equal(b.applyUrl, "https://jobs.lever.co/acme/lv-2", "falls back to hostedUrl, not a guess");
    assert.equal(byId(r.jobs, "lv-3").cityClass, "unknown");
    assert.equal(a.postedAt, new Date(1761000000000).toISOString());
  });
  lv.restore();

  const ab = installFixtures([(u) => (u.includes("api.ashbyhq.com/posting-api/job-board/acme") ? json(F.ashby) : null)]);
  await t("ashby: skips unlisted, both cities, India remote, compensation", async () => {
    const r = await getProvider("ashby").fetchJobs(src("ashby"));
    assert.deepEqual(r.jobs.map((j) => j.externalJobId).sort(), ["as-1", "as-3"]);
    const a = byId(r.jobs, "as-1"); assert.equal(a.cityClass, "both"); assert.equal(a.salaryMax, 5000000); assert.equal(a.applyUrl, "https://jobs.ashbyhq.com/acme/as-1/application"); assert.equal(a.experienceMin, 4);
    assert.equal(byId(r.jobs, "as-3").cityClass, "india_remote");
  });
  ab.restore();

  const sr = installFixtures([(u) => { const m = /offset=(\d+)/.exec(u); return u.includes("api.smartrecruiters.com/v1/companies/acme/postings") ? json(F.smartrecruiters(Number(m![1]), 150, Number(m![1]) === 0 ? 100 : 50)) : null; }]);
  await t("smartrecruiters: paginates to the end and is complete", async () => {
    const r = await getProvider("smartrecruiters").fetchJobs(src("smartrecruiters"));
    assert.equal(r.jobs.length, 150); assert.equal(r.pages, 2); assert.equal(r.complete, true);
    assert.equal(byId(r.jobs, "sr-1").cityClass, "bengaluru"); assert.equal(byId(r.jobs, "sr-0").cityClass, "other_india");
    assert.equal(byId(r.jobs, "sr-1").applyUrl, "https://jobs.smartrecruiters.com/acme/sr-1");
  });
  await t("smartrecruiters: hitting the page cap is INCOMPLETE (so nothing gets closed)", async () => {
    const r = await getProvider("smartrecruiters").fetchJobs(src("smartrecruiters"), { maxPages: 1 });
    assert.equal(r.jobs.length, 100); assert.equal(r.complete, false); assert.match(r.incompleteReason ?? "", /page/);
  });
  sr.restore();

  const wd = installFixtures([(u, i) => {
    if (!u.includes("acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs")) return null;
    const b = JSON.parse(String(i.body)); return json(F.workday(b.offset, 45, Math.min(20, 45 - b.offset)));
  }]);
  await t("workday: POST paging, India search term, requisition ids, approx dates", async () => {
    const s = src("workday", { boardSlug: null, tenant: "acme", host: "wd3", careerSite: "External" });
    const r = await getProvider("workday").fetchJobs(s);
    assert.equal(r.jobs.length, 45); assert.equal(r.complete, true); assert.equal(r.pages, 3);
    assert.equal(wd.calls[0]!.method, "POST"); assert.equal((wd.calls[0]!.body as any).searchText, "India"); assert.equal((wd.calls[0]!.body as any).limit, 20);
    const j = byId(r.jobs, "R1001"); assert.equal(j.applyUrl, "https://acme.wd3.myworkdayjobs.com/en-US/External/job/Bangalore/Analyst-1_R1001"); assert.equal(j.cityClass, "bengaluru"); assert.ok(j.postedAt); assert.equal(j.metadata.postedAtApprox, true);
    const ph = byId(r.jobs, "R1000"); assert.equal(ph.cityClass, "unknown"); assert.equal(ph.metadata.multiLocationPlaceholder, true); assert.equal(ph.postedAt, null, '"30+ Days Ago" is a floor, not a date');
  });
  await t("workday: page cap → incomplete", async () => { const r = await getProvider("workday").fetchJobs(src("workday", { boardSlug: null, tenant: "acme", host: "wd3", careerSite: "External" }), { maxPages: 2 }); assert.equal(r.complete, false); });
  await t("workday: parsePostedOn", () => { const now = Date.UTC(2026, 10, 1, 12); assert.equal(parsePostedOn("Posted Today", now), "2026-11-01T00:00:00.000Z"); assert.equal(parsePostedOn("Posted 5 Days Ago", now), "2026-10-27T00:00:00.000Z"); assert.equal(parsePostedOn("Posted 30+ Days Ago", now), null); assert.equal(parsePostedOn("", now), null); });
  wd.restore();

  const px = installFixtures([(u) => (u.includes("acme.jobs.personio.de/xml") ? text(F.personioXml, { headers: { "content-type": "application/xml" } }) : null)]);
  await t("personio: XML positions, multiple offices, years of experience", async () => {
    const r = await getProvider("personio").fetchJobs(src("personio"));
    assert.equal(r.jobs.length, 2); const a = byId(r.jobs, "9001");
    assert.equal(a.cityClass, "both"); assert.equal(a.experienceMin, 2); assert.equal(a.experienceMax, 5); assert.equal(a.applyUrl, "https://acme.jobs.personio.de/job/9001"); assert.match(a.description ?? "", /APIs/);
    assert.equal(personioYears("lt-1").max, 1); assert.equal(personioYears("gt-15").min, 15);
  });
  px.restore();
  const pxBad = installFixtures([(u) => (u.includes("jobs.personio.de") ? text("<html>marketing</html>") : null)]);
  await t("personio: a non-feed 200 (dead tenant) fails loudly instead of 'no jobs'", async () => { await assert.rejects(() => getProvider("personio").fetchJobs(src("personio")), (e: IngestError) => e.category === "bad_response"); });
  pxBad.restore();

  const misc = installFixtures([
    (u) => (u.includes("apply.workable.com/api/v1/widget/accounts/acme") ? json(F.workable) : null),
    (u) => (u.includes("acme.recruitee.com/api/offers") ? json(F.recruitee) : null),
    (u) => (u.includes("acme.breezy.hr/json") ? json(F.breezy) : null),
    (u) => (u.includes("acme.keka.com/careers/api/jobs/default/active") ? json(F.keka) : null),
    (u) => (u.includes("acme.darwinbox.in/ms/candidateapi/job/alljobs") ? json(F.darwinbox) : null),
  ]);
  await t("workable", async () => { const r = await getProvider("workable").fetchJobs(src("workable")); assert.equal(r.jobs.length, 2); assert.equal(byId(r.jobs, "WK1").cityClass, "hyderabad"); assert.equal(byId(r.jobs, "WK1").applyUrl, "https://apply.workable.com/j/WK1/apply"); assert.equal(byId(r.jobs, "WK2").cityClass, "india_remote"); assert.equal(byId(r.jobs, "WK2").applyUrl, "https://apply.workable.com/j/WK2"); });
  await t("recruitee: unpublished skipped, UTC date parsed", async () => { const r = await getProvider("recruitee").fetchJobs(src("recruitee")); assert.equal(r.jobs.length, 1); assert.equal(r.jobs[0]!.postedAt, "2026-10-21T13:16:05.000Z"); assert.equal(r.jobs[0]!.cityClass, "bengaluru"); assert.equal(r.jobs[0]!.applyUrl, "https://acme.recruitee.com/o/qa-engineer/c/new"); });
  await t("breezy: `name` is the title", async () => { const r = await getProvider("breezy").fetchJobs(src("breezy")); assert.equal(r.jobs[0]!.title, "SRE"); assert.equal(r.jobs[0]!.cityClass, "hyderabad"); });
  await t("keka: experience range, apply URL", async () => { const r = await getProvider("keka").fetchJobs(src("keka")); assert.equal(r.jobs[0]!.cityClass, "bengaluru"); assert.equal(r.jobs[0]!.experienceMin, 2); assert.equal(r.jobs[0]!.applyUrl, "https://acme.keka.com/careers/jobdetails/501"); });
  await t("darwinbox: POST body carries companyId, remote flag, location", async () => {
    const r = await getProvider("darwinbox").fetchJobs(src("darwinbox", { careerSite: "abc123" }));
    assert.equal(r.jobs.length, 2); assert.equal((misc.calls.at(-1)!.body as any).companyId, "abc123");
    assert.equal(byId(r.jobs, "d1").cityClass, "hyderabad"); assert.equal(byId(r.jobs, "d1").experienceMin, 3); assert.equal(byId(r.jobs, "d2").cityClass, "india_remote");
  });
  misc.restore();

  await t("every implemented provider has documentation metadata and a fetch implementation", () => {
    assert.deepEqual(PROVIDER_META.map((m) => m.provider).sort(), [...PROVIDER_IDS].sort());
    for (const m of PROVIDER_META) for (const k of ["endpoint", "auth", "resolution", "fields", "pagination", "rateLimit", "limitations", "verification"] as const) assert.ok(m[k].length > 3, `${m.provider}.${k}`);
    assert.ok(PROVIDER_IDS.length >= 3); for (const k of Object.keys(NOT_IMPLEMENTED)) assert.ok(!PROVIDER_IDS.includes(k as ProviderId));
  });
  await t("board identifiers are validated before they reach a URL", async () => {
    for (const bad of ["../etc", "a b", "x/y", "", "a".repeat(200)]) await assert.rejects(() => getProvider("greenhouse").fetchJobs(src("greenhouse", { boardSlug: bad })), (e: IngestError) => e.category === "client_error", bad);
    await assert.rejects(() => getProvider("workday").fetchJobs(src("workday", { boardSlug: null, tenant: "acme", host: "evil.com/x", careerSite: "S" })), (e: IngestError) => e.category === "client_error");
  });

  console.log("http layer");
  await t("304 Not Modified → no parsing, validators echoed", async () => {
    const f = installFixtures([() => new Response(null, { status: 304, headers: { etag: 'W/"x"' } })]);
    const r = await getProvider("greenhouse").fetchJobs(src("greenhouse", { etag: 'W/"x"' }));
    assert.equal(r.notModified, true); assert.equal(r.jobs.length, 0); assert.equal(r.httpStatus, 304); assert.equal(r.etag, 'W/"x"'); f.restore();
  });
  await t("429 → rate_limited with Retry-After", async () => {
    const f = installFixtures([() => new Response("slow down", { status: 429, headers: { "retry-after": "120" } })]);
    await assert.rejects(() => httpRequest("https://api.lever.co/x"), (e: IngestError) => e.category === "rate_limited" && e.retryAfterSeconds === 120 && e.status === 429); f.restore();
  });
  await t("5xx / 403 / 404 are classified", async () => {
    for (const [status, cat] of [[500, "server_error"], [502, "server_error"], [403, "blocked"], [404, "not_found"], [504, "timeout"]] as const) {
      const f = installFixtures([() => new Response("x", { status })]);
      await assert.rejects(() => httpRequest("https://api.lever.co/x"), (e: IngestError) => e.category === cat, String(status)); f.restore();
    }
  });
  await t("bot challenge page is detected, not treated as data", async () => {
    const f1 = installFixtures([() => new Response("<html><title>Just a moment...</title>cf-chl</html>", { status: 403 })]);
    await assert.rejects(() => httpRequest("https://x.darwinbox.in/a"), (e: IngestError) => e.category === "challenge"); f1.restore();
    const f2 = installFixtures([() => new Response("<html>Attention Required! captcha</html>", { status: 200, headers: { "content-type": "application/json" } })]);
    await assert.rejects(() => httpJson("https://x.darwinbox.in/a"), (e: IngestError) => e.category === "challenge"); f2.restore();
  });
  await t("200 HTML or truncated JSON → invalid_json (never an empty job list)", async () => {
    const f = installFixtures([() => new Response("<html>login</html>", { status: 200 })]);
    await assert.rejects(() => httpJson("https://api.lever.co/x"), (e: IngestError) => e.category === "invalid_json"); f.restore();
    const g = installFixtures([() => new Response('{"jobs":[{"id":1', { status: 200 })]);
    await assert.rejects(() => httpJson("https://api.lever.co/x"), (e: IngestError) => e.category === "invalid_json"); g.restore();
  });
  await t("unexpected structure → bad_response", async () => {
    const f = installFixtures([() => json({ error: "nope" })]);
    await assert.rejects(() => getProvider("greenhouse").fetchJobs(src("greenhouse")), (e: IngestError) => e.category === "bad_response"); f.restore();
  });
  await t("response size cap", async () => {
    const f = installFixtures([() => new Response("x".repeat(5000), { status: 200 })]);
    await assert.rejects(() => httpRequest("https://api.lever.co/x", { maxBytes: 1000 }), (e: IngestError) => e.category === "too_large"); f.restore();
  });
  await t("timeout → timeout category", async () => {
    const f = installFixtures([(_u, init) => new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))]);
    await assert.rejects(() => httpRequest("https://api.lever.co/x", { timeoutMs: 30 }), (e: IngestError) => e.category === "timeout"); f.restore();
  });
  await t("SSRF: http://, private IPs, credentials and redirects into the internal network are refused", async () => {
    const f = installFixtures([(u) => (u.startsWith("https://api.lever.co/redir") ? new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } }) : new Response("{}", { status: 200 }))]);
    for (const bad of ["http://api.lever.co/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://user:pw@api.lever.co/x", "https://localhost/x", "https://api.lever.co/redir"]) await assert.rejects(() => httpRequest(bad), (e: IngestError) => e.category === "unsafe_url", bad);
    f.restore();
  });
  await t("a public redirect is followed (and re-validated)", async () => {
    const f = installFixtures([(u) => (u.endsWith("/a") ? new Response(null, { status: 301, headers: { location: "https://api.lever.co/b" } }) : u.endsWith("/b") ? json({ ok: 1 }) : null)]);
    assert.deepEqual((await httpJson("https://api.lever.co/a")).data, { ok: 1 }); f.restore();
  });
  await t("retry-after parsing and exponential backoff with jitter", () => {
    assert.equal(parseRetryAfter("30"), 30); assert.equal(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT", Date.parse("Wed, 21 Oct 2026 07:27:00 GMT")), 60); assert.equal(parseRetryAfter("x"), undefined);
    const z = () => 0; const seq = [1, 2, 3, 4, 5, 6].map((n) => backoffSeconds(n, undefined, z)); for (let i = 1; i < seq.length; i++) assert.ok(seq[i]! >= seq[i - 1]!); assert.ok(backoffSeconds(30, undefined, z) <= 12 * 3600);
    assert.ok(backoffSeconds(1, 3600, z) >= 3600, "honours Retry-After"); assert.ok(backoffSeconds(1, undefined, () => 1) > backoffSeconds(1, undefined, z), "jitter adds time");
  });

  console.log("detection + limits");
  await t("detectAts recognises every supported ATS URL", () => {
    const cases: [string, string, string?][] = [
      ["https://boards.greenhouse.io/acme/jobs/123", "greenhouse"], ["https://job-boards.greenhouse.io/acme", "greenhouse"], ["https://boards-api.greenhouse.io/v1/boards/acme/jobs", "greenhouse"],
      ["https://jobs.lever.co/acme/abc", "lever"], ["https://jobs.ashbyhq.com/acme", "ashby"], ["https://jobs.smartrecruiters.com/Acme/123", "smartrecruiters"], ["https://apply.workable.com/acme/", "workable"],
      ["https://acme.recruitee.com/", "recruitee"], ["https://acme.breezy.hr/", "breezy"], ["https://acme.jobs.personio.de/", "personio"], ["https://acme.keka.com/careers/", "keka"],
      ["https://acme.darwinbox.in/ms/candidatev2/a1b2c3/careers", "darwinbox"], ["https://acme.wd3.myworkdayjobs.com/en-US/External/jobs", "workday"],
    ];
    for (const [u, p] of cases) assert.equal(detectAts(u)?.provider, p, u);
    assert.equal(detectAts("https://acme.wd3.myworkdayjobs.com/en-US/External/jobs")?.careerSite, "External");
    assert.equal(detectAts("https://acme.darwinbox.in/ms/candidatev2/a1b2c3/careers")?.careerSite, "a1b2c3");
    assert.equal(detectAts('<a href="https://jobs.lever.co/acme">Careers</a>')?.boardSlug, "acme");
    assert.equal(detectAts("https://www.example.com/careers"), null); assert.equal(detectAts("https://boards.greenhouse.io/embed/job_board"), null); assert.equal(detectAts(null), null);
  });
  await t("host keys group requests the way the rate limiter needs", () => { assert.equal(hostKeyOf({ provider: "workday", board_slug: null, tenant: "acme", host: "wd3", config: {} }), "acme.wd3.myworkdayjobs.com"); assert.equal(hostKeyOf({ provider: "lever", board_slug: "a", tenant: null, host: null, config: { region: "eu" } }), "api.eu.lever.co"); });
  await t("KeyedLimiter never exceeds the per-key limit", async () => {
    const lim = new KeyedLimiter(2); let cur = 0, peak = 0;
    await Promise.all(Array.from({ length: 10 }, () => lim.run(["k"], async () => { cur++; peak = Math.max(peak, cur); await new Promise((r) => setTimeout(r, 5)); cur--; })));
    assert.equal(peak, 2);
  });
  await t("two-key acquisition cannot deadlock", async () => {
    const lim = new KeyedLimiter(1);
    await Promise.all([lim.run(["a", "b"], async () => {}), lim.run(["b", "a"], async () => {}), lim.run(["a"], async () => {}), lim.run(["b"], async () => {})]);
  });
  done("ingestion (pure)");
}
main().catch((e) => { console.error(e); process.exit(1); });
