import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { countInvalidApplyUrls, mapCompanyApiJob, mapCompanyApiJobs, mergeCompanyJob, mergeJobLists } from "@/lib/company-jobs/adapter";
import { applicationUrlOrNull, validateApplicationUrl } from "@/lib/company-jobs/urls";
import { resolveCompanyLogo } from "@/lib/logos/resolve";
import { setPublicHostResolver } from "@/lib/net/public-url";
import { companyInitials } from "@/lib/logos/initials";
import { matchesCity, parseBoards } from "@/lib/company-jobs/boards";
import { overlayArenaJobs } from "@/lib/company-jobs/overlay";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";
(globalThis as unknown as { React: typeof React }).React = React; // tsx compiles components with the classic JSX runtime
import { JobApplyActions } from "@/components/companies/JobApplyActions";

const FIX = path.join(process.cwd(), "scripts", "fixtures");
const supplied = JSON.parse(fs.readFileSync(path.join(FIX, "pwc-jobs.json"), "utf8"));
const live = JSON.parse(fs.readFileSync(path.join(FIX, "pwc-jobs-live.json"), "utf8"));

let passed = 0;
let failed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 4).join("\n    ")}`);
  }
}

async function main() {
  console.log("company jobs adapter (PwC fixture)");
  await t("all 144 supplied records are parsed", () => {
    const r = mapCompanyApiJobs(supplied, "pwc");
    assert.ok(!("error" in r));
    assert.equal(r.jobs.length, 144);
  });
  await t("all 144 valid supplied application URLs survive normalisation", () => {
    const r = mapCompanyApiJobs(supplied, "pwc");
    assert.ok(!("error" in r));
    assert.equal(r.jobs.filter((j) => j.applicationUrl).length, 144);
    assert.ok(r.jobs.every((j) => j.applicationUrl === validateApplicationUrl(j.applicationUrl)));
  });
  await t("PwC application links remain on the Workday careers domain", () => {
    const r = mapCompanyApiJobs(supplied, "pwc");
    assert.ok(!("error" in r));
    for (const j of r.jobs) {
      assert.match(j.applicationUrl!, /pwc\.wd3\.myworkdayjobs\.com/i);
    }
  });
  await t("external job IDs are stable", () => {
    const a = mapCompanyApiJobs(supplied, "pwc");
    const b = mapCompanyApiJobs(supplied, "pwc");
    assert.ok(!("error" in a) && !("error" in b));
    assert.deepEqual(a.jobs.map((j) => j.externalJobId), b.jobs.map((j) => j.externalJobId));
    assert.equal(new Set(a.jobs.map((j) => j.externalJobId)).size, 144);
  });
  await t("missing application URLs remain unavailable rather than fabricated", () => {
    const r = mapCompanyApiJobs(live, "pwc");
    assert.ok(!("error" in r));
    assert.equal(r.jobs.length, 144);
    assert.ok(r.jobs.every((j) => j.applicationUrl === null));
    const one = mapCompanyApiJob({ title: "Analyst", applyUrl: "" }, "pwc");
    assert.equal(one!.applicationUrl, null);
  });
  await t("existing valid links are not overwritten by missing data", () => {
    const prev = mapCompanyApiJob({ id: "1", title: "A", applyUrl: "https://pwc.wd3.myworkdayjobs.com/job/1" }, "pwc")!;
    const next = mapCompanyApiJob({ id: "1", title: "A", applyUrl: "" }, "pwc")!;
    assert.equal(next.applicationUrl, null);
    assert.equal(mergeCompanyJob(prev, next).applicationUrl, prev.applicationUrl);
  });
  await t("unsafe URL destinations are rejected", () => {
    assert.equal(validateApplicationUrl("javascript:alert(1)"), null);
    assert.equal(validateApplicationUrl("data:text/html,x"), null);
    assert.equal(validateApplicationUrl("http://pwc.wd3.myworkdayjobs.com/x"), null);
    assert.equal(applicationUrlOrNull("https://www.blrstartuparena.com/companies/pwc", "https://www.blrstartuparena.com/companies/pwc", "pwc"), null);
    assert.equal(validateApplicationUrl("https://user:pass@evil.example/x"), null);
    assert.ok(validateApplicationUrl("https://pwc.wd3.myworkdayjobs.com/en-US/job/1"));
  });
  await t("duplicate company/job records are not created", () => {
    const r = mapCompanyApiJobs(supplied, "pwc");
    assert.ok(!("error" in r));
    const twice = mergeJobLists(r.jobs, r.jobs);
    assert.equal(twice.merged.length, 144);
    assert.equal(twice.newCount, 0);
  });

  await t("every supplied application URL is preserved exactly, not just kept non-null", () => {
    const r = mapCompanyApiJobs(supplied, "pwc");
    assert.ok(!("error" in r));
    const byId = new Map(supplied.map((x: { id: string; applyUrl: string }) => [x.id, x.applyUrl]));
    for (const j of r.jobs) assert.equal(j.applicationUrl, byId.get(j.externalJobId!));
  });
  await t("legacy field names (apply_url, applicationUrl) are accepted", () => {
    assert.equal(mapCompanyApiJob({ title: "A", apply_url: "https://pwc.wd3.myworkdayjobs.com/x/job/1" }, "pwc")!.applicationUrl, "https://pwc.wd3.myworkdayjobs.com/x/job/1");
    assert.equal(mapCompanyApiJob({ title: "A", applicationUrl: "https://pwc.wd3.myworkdayjobs.com/x/job/2" }, "pwc")!.applicationUrl, "https://pwc.wd3.myworkdayjobs.com/x/job/2");
  });
  await t("invalid links are counted, empty ones are not", () => {
    const body = [{ title: "a", applyUrl: "javascript:alert(1)" }, { title: "b", applyUrl: "" }, { title: "c", applyUrl: "https://www.blrstartuparena.com/companies/pwc" }, { title: "d", applyUrl: "https://pwc.wd3.myworkdayjobs.com/j/1" }];
    assert.equal(countInvalidApplyUrls(body, "pwc", "https://www.blrstartuparena.com/companies/pwc"), 2);
  });
  await t("Apply now renders the real Workday URL in a new tab; no URL renders the fallback and no button", () => {
    const r = mapCompanyApiJobs(supplied, "pwc");
    assert.ok(!("error" in r));
    const withUrl = overlayArenaJobs([], r.jobs.slice(0, 1))[0];
    const html = renderToStaticMarkup(createElement(JobApplyActions, { job: withUrl, slug: "pwc", compact: true }));
    assert.ok(html.includes(`href="${withUrl.applicationUrl}"`));
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer nofollow"/);
    assert.match(html, /Apply now/);
    const none = overlayArenaJobs([], (mapCompanyApiJobs(live, "pwc") as { jobs: Parameters<typeof overlayArenaJobs>[1] }).jobs.slice(0, 1))[0];
    const html2 = renderToStaticMarkup(createElement(JobApplyActions, { job: none, slug: "pwc", sourcePage: "https://www.blrstartuparena.com/companies/pwc", compact: true }));
    assert.ok(!html2.includes("Apply now"));
    assert.match(html2, /Application link unavailable/);
  });

  await t("separate openings with the same title and location from one source are all kept", () => {
    const mk = (id: string) => mapCompanyApiJob({ id, title: "Associate", location: "Bengaluru", applyUrl: `https://pwc.wd3.myworkdayjobs.com/j/${id}` }, "pwc")!;
    assert.equal(mergeJobLists([], [mk("1"), mk("2"), mk("3")]).merged.length, 3);
  });
  await t("city matching accepts Hyderabad areas and rejects other cities", () => {
    assert.equal(matchesCity("Hyderabad, Telangana, India", "hyderabad"), true);
    assert.equal(matchesCity("Gachibowli, Hyderabad", "hyderabad"), true);
    assert.equal(matchesCity("Bengaluru, Karnataka", "hyderabad"), false);
    assert.equal(matchesCity(null, "hyderabad"), false);
    assert.equal(matchesCity("Remote, India", "hyderabad"), false);
  });
  await t("board list parsing drops malformed, unsupported and duplicate entries", () => {
    const boards = parseBoards({ boards: [
      { name: "A", ats: "greenhouse", slug: "a", city: "hyderabad" },
      { name: "A again", ats: "greenhouse", slug: "a", city: "hyderabad" },
      { name: "B", ats: "workday", slug: "b", city: "hyderabad" },
      { name: "C", ats: "lever", slug: "../etc", city: "hyderabad" },
      { name: "D", ats: "ashby", slug: "d", city: "atlantis" },
      { name: "", ats: "lever", slug: "e", city: "hyderabad" },
    ] });
    assert.deepEqual(boards.map((b) => b.name), ["A"]);
  });
  console.log("logos");
  setPublicHostResolver(async () => ["93.184.216.34"]);
  await t("logos resolve from verified websites only", async () => {
    const html = '<html><head><link rel="icon" href="/icon.png"></head></html>';
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/icon.png") || url.endsWith("favicon.ico")) {
        return { status: 200, headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) }, arrayBuffer: async () => png, text: async () => "" };
      }
      return { status: 200, headers: { get: () => "text/html" }, arrayBuffer: async () => Buffer.from(html), text: async () => html };
    };
    const ok = await resolveCompanyLogo("https://example.com", { fetchImpl: fetchImpl as any });
    assert.equal(ok.status, "resolved");
    assert.equal(ok.sourceDomain, "example.com");
    const none = await resolveCompanyLogo(null);
    assert.equal(none.status, "initials");
    const guessed = await resolveCompanyLogo("pwc");
    assert.equal(guessed.status, "initials");
  });
  await t("broken logos fall back to company initials", async () => {
    const fetchImpl = async () => ({ status: 404, headers: { get: () => null }, arrayBuffer: async () => Buffer.alloc(0), text: async () => "" });
    const r = await resolveCompanyLogo("https://example.com", { fetchImpl: fetchImpl as any });
    assert.ok(r.status === "initials" || r.status === "failed");
    assert.equal(companyInitials("PwC India"), "PI");
    assert.equal(companyInitials("Stripe"), "ST");
  });
  await t("malicious redirects are rejected", async () => {
    const fetchImpl = async () => ({
      status: 302,
      headers: { get: (n: string) => (n.toLowerCase() === "location" ? "http://127.0.0.1/secret" : null) },
      arrayBuffer: async () => Buffer.alloc(0),
      text: async () => "",
    });
    const r = await resolveCompanyLogo("https://example.com", { fetchImpl: fetchImpl as any });
    assert.notEqual(r.status, "resolved");
  });

  console.log("overlay / cards");
  await t("user-facing job cards keep a real apply URL when the API overlay has one", () => {
    const file = [{ id: "1", title: "Analyst", location: "Bengaluru", mode: "hybrid" as const, type: "Full-time", posted: "2026-10-22", experience: "2+ years", salary: null, family: "consulting", fresher: false, applicationUrl: null, applyUrl: null, jobDetailUrl: null, seniority: "associate", summary: "" }];
    const db = [mapCompanyApiJob({ id: "1", title: "Analyst", applyUrl: "https://pwc.wd3.myworkdayjobs.com/job/1", location: "Bengaluru" }, "pwc")!];
    const out = overlayArenaJobs(file, db);
    assert.equal(out[0].applicationUrl, "https://pwc.wd3.myworkdayjobs.com/job/1");
  });

  console.log("  (overlap lock + timeout-does-not-delete are in npm run test:db)");

  console.log(`\n${passed} company-job checks passed${failed ? `, ${failed} failed` : ""}`);
  process.exit(failed ? 1 : 0);
}
main();
