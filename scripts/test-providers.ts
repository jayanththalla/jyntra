// Provider reliability: HTTP layer (retries, Retry-After, cache poisoning), Himalayas adapter, health messages, config switches.
// Uses a throw-away local HTTP server; no internet. Run: npx tsx scripts/test-providers.ts
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { FetchError, cachedTextInfo, parseRetryAfter, retryDelayMs, errorCategory } from "@/lib/http";
import { discoverHimalayas, himalayasJob, himalayasSource, parseHimalayasPage, type HimalayasJob } from "@/sources/jobs/himalayas";
import { discoverBlrArena, arenaJob } from "@/sources/jobs/blrarena";
import { classifySource, redact, userMessage, type SourceHealth } from "@/lib/refresh/health";
import { disabledByConfig, gdeltEnabled, himalayasEnabled } from "@/lib/providers/config";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { process.exitCode = 1; console.error(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
const nowSec = Math.floor(Date.now() / 1000);
const job = (o: Partial<HimalayasJob> = {}): HimalayasJob => ({ title: "Backend Engineer", companyName: "Acme", locationRestrictions: ["India"], pubDate: nowSec - 86_400, guid: "https://himalayas.app/companies/acme/jobs/backend-engineer", applicationLink: "https://acme.example/apply?id=7", ...o });
const log = () => { const l: string[] = []; return Object.assign((m: string) => l.push(m), { lines: l }); };

async function main() {
  let mode: "ok" | "html" | "429" | "500" | "slow" = "ok";
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    if (mode === "429" && hits % 2 === 1) { res.writeHead(429, { "Retry-After": "0" }); return res.end("slow down"); }
    if (mode === "500") { res.writeHead(503); return res.end("down"); }
    if (mode === "html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<html>Just a moment...</html>"); }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ jobs: [job()] }));
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const uniq = (n: string) => `${base}/${n}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  console.log("http layer");
  await t("Retry-After is parsed as seconds and as a date", () => {
    assert.equal(parseRetryAfter("7"), 7);
    assert.equal(parseRetryAfter(new Date(Date.now() + 20_000).toUTCString())! >= 19, true);
    assert.equal(parseRetryAfter("nonsense"), undefined);
    assert.equal(retryDelayMs(0, "2"), 2000); assert.equal(retryDelayMs(0, "999"), 10_000, "capped");
  });
  await t("429 then success is retried once and succeeds", async () => {
    mode = "429"; hits = 0;
    const r = await cachedTextInfo(uniq("a"), 1, { skipRobots: true, retries: 1 });
    assert.equal(r.from, "network"); assert.ok(hits >= 2);
  });
  await t("persistent 503 → FetchError(server_error) after bounded attempts", async () => {
    mode = "500"; hits = 0;
    await assert.rejects(cachedTextInfo(uniq("b"), 1, { skipRobots: true, retries: 1 }), (e: any) => e instanceof FetchError && e.category === "server_error");
    assert.equal(hits, 2, "1 try + 1 retry, no more");
  });
  await t("a 200 error page is NOT cached when validation fails", async () => {
    const url = uniq("c"); mode = "html";
    await assert.rejects(cachedTextInfo(url, 1, { skipRobots: true, retries: 0, validate: (b) => void JSON.parse(b) }), (e: any) => e.category === "bad_response");
    mode = "ok";
    const r = await cachedTextInfo(url, 1, { skipRobots: true, retries: 0, validate: (b) => void JSON.parse(b) });
    assert.equal(r.from, "network", "nothing poisoned the cache");
  });
  await t("stale copy is labelled 'stale' with its real fetch time; allowStale:false throws instead", async () => {
    const url = uniq("d"); mode = "ok";
    await cachedTextInfo(url, 1, { skipRobots: true, retries: 0 });
    mode = "500";
    const s = await cachedTextInfo(url, 0, { skipRobots: true, retries: 0 });
    assert.equal(s.from, "stale"); assert.equal(s.error?.category, "server_error"); assert.ok(Date.now() - Date.parse(s.fetchedAt) < 60_000);
    await assert.rejects(cachedTextInfo(url, 0, { skipRobots: true, retries: 0, allowStale: false }));
  });
  await t("categories", () => {
    assert.equal(errorCategory(new Error("The operation was aborted")), "timeout"); assert.equal(errorCategory(new FetchError("x", 429)), "rate_limited");
  });

  console.log("himalayas adapter");
  await t("page shape is validated", () => {
    assert.equal(parseHimalayasPage(JSON.stringify({ jobs: [job()] })).length, 1);
    assert.throws(() => parseHimalayasPage("<html>blocked</html>"), /not JSON/);
    assert.throws(() => parseHimalayasPage(JSON.stringify({ error: "nope" })), /no jobs array/);
    assert.throws(() => parseHimalayasPage(JSON.stringify([job()])), /no jobs array/);
  });
  await t("original application link and Himalayas job page are preserved", () => {
    const j = himalayasJob(job())!; assert.equal(j.applyUrl, "https://acme.example/apply?id=7"); assert.equal(j.url, job().guid); assert.equal(j.sourceUrl, job().guid); assert.equal(j.source, "himalayas");
  });
  await t("expired and non-India-restricted jobs are dropped", () => {
    assert.equal(himalayasJob(job({ expiryDate: nowSec - 60 })), null);
    assert.equal(himalayasJob(job({ locationRestrictions: ["United States"] })), null);
    assert.ok(himalayasJob(job({ expiryDate: nowSec + 86_400 })));
  });
  await t("page 1 failure fails the source and keeps the error category (nothing is closed)", async () => {
    await assert.rejects(discoverHimalayas({ log: log() }, async () => { throw new FetchError("HTTP 429", 429, undefined, 30); }), (e: any) => e.category === "rate_limited" && e.retryAfterSeconds === 30);
  });
  await t("a later page failing keeps earlier jobs and marks lists INCOMPLETE so nothing is closed", async () => {
    let calls = 0;
    const out = await discoverHimalayas({ log: log() }, async (p) => { calls++; if (p === 2) throw new FetchError("HTTP 429", 429); return { jobs: [job({ companyName: "Acme" }), job({ companyName: "Beta", guid: "https://himalayas.app/b" })] }; });
    assert.equal(calls, 2, "stops at the first failure: no hammering a rate-limited API");
    assert.equal(out.length, 2); assert.ok(out.every((r) => r.jobsComplete === false));
  });
  await t("a clean crawl leaves jobsComplete unset", async () => {
    const out = await discoverHimalayas({ log: log() }, async (p) => ({ jobs: p === 1 ? [job()] : [] }));
    assert.equal(out.length, 1); assert.equal(out[0].jobsComplete, undefined);
  });
  await t("zero jobs on page 1 is 'no jobs', not an error", async () => {
    assert.deepEqual(await discoverHimalayas({ log: log() }, async () => ({ jobs: [] })), []);
  });

  console.log("config switches and health");
  await t("HIMALAYAS_ENABLED=false disables the source without throwing", () => {
    const prev = process.env.HIMALAYAS_ENABLED;
    process.env.HIMALAYAS_ENABLED = "false";
    assert.equal(himalayasEnabled(), false); assert.match(himalayasSource.disabledReason()!, /HIMALAYAS_ENABLED/);
    process.env.HIMALAYAS_ENABLED = prev ?? ""; if (prev === undefined) delete process.env.HIMALAYAS_ENABLED;
    assert.equal(himalayasSource.disabledReason(), null);
  });
  await t("GDELT is off unless enabled", () => { assert.equal(gdeltEnabled({}), false); assert.equal(gdeltEnabled({ GDELT_ENABLED: "true" }), true); assert.ok(disabledByConfig("gdelt", {})); });
  const row = (o: Partial<SourceHealth> = {}): SourceHealth => ({ id: "himalayas", name: "Himalayas remote jobs", kind: "job_board", enabled: true, last_run_at: new Date().toISOString(), last_success_at: new Date(Date.now() - 3 * 3600_000).toISOString(), last_status: "error", last_error: "x", last_error_category: "rate_limited", next_retry_at: null, consecutive_failures: 2, last_duration_ms: 10, ...o });
  await t("failing source: calm one-line message with the REAL last-success time, no internals", () => {
    const r = row(); assert.equal(classifySource(r), "failing");
    const m = userMessage(r.id, r.name, "failing", r.last_error_category, r.last_success_at)!;
    assert.match(m, /Himalayas is busy/); assert.match(m, /3 h ago/); assert.doesNotMatch(m, /HTTP|429|https?:/);
  });
  await t("a disabled provider is 'disabled', never 'failing'", () => {
    assert.equal(classifySource(row({ enabled: false })), "disabled");
    assert.equal(classifySource(row(), Date.now(), { HIMALAYAS_ENABLED: "false" }), "disabled");
  });
  await t("secrets and query strings are redacted from stored errors", () => {
    const r = redact("GET https://api.example.com/x?api_key=SECRET123&q=1 failed; Bearer abc.def-ghi key=ZZZ");
    assert.doesNotMatch(r, /SECRET123|abc\.def|ZZZ|q=1/);
  });
  await t("BLR Arena: companies without a jobs endpoint are skipped and nothing is claimed complete", async () => {
    const log = () => {};
    const r = await discoverBlrArena({ log }, async (url) => url.endsWith("/api/companies") ? JSON.stringify([{ slug: "pwc", name: "PwC" }, { slug: "nojobs", name: "No Jobs Co" }, { slug: "bad slug!" }]) : url.includes("/pwc/jobs") ? JSON.stringify([{ id: "abc", title: "Analyst", applyUrl: "https://pwc.example/j/1", location: "Bengaluru", postedAt: "2026-10-22T00:00:00+00:00", expMin: 2, salaryEstimated: true, salaryMinLpa: 9 }, { nope: 1 }]) : null, []);
    assert.equal(r.length, 1); assert.equal(r[0].name, "PwC"); assert.equal(r[0].jobs!.length, 1); assert.equal(r[0].jobsComplete, false);
    assert.equal(r[0].jobs![0].applyUrl, "https://pwc.example/j/1");
    const j = arenaJob({ id: "z", title: "X", applyUrl: "", workMode: "remote", expMin: 12, expMax: null }, "a")!;
    assert.equal(j.applyUrl, null); assert.equal(j.minExperience, "12+ years"); assert.equal(j.remote, "yes");
    assert.equal(r[0].jobs![0].salary, null); assert.equal(r[0].jobs![0].postedDate, "2026-10-22"); // estimated salary is never shown as stated
    assert.equal(arenaJob({ title: "X", applyUrl: "javascript:alert(1)" }, "a")!.applyUrl, null);
  });
  await t("BLR Arena: off by default, and a total failure is reported, not hidden", async () => {
    assert.ok(disabledByConfig("blrarena", {})); assert.equal(disabledByConfig("blrarena", { BLRARENA_ENABLED: "true" }), null);
    await assert.rejects(discoverBlrArena({ log() {} }, async () => { throw new Error("boom"); }, ["pwc"]), /could not be read/);
  });
  server.close();
  console.log(`\n${passed} provider checks passed`);
}
main();
