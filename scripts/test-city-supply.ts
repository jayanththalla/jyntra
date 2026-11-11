// Pure tests (no DB, no network) for the Bengaluru / Hyderabad / Chennai data supply chain.
import assert from "node:assert/strict";
import { classifyLocation, citiesFromClass } from "@/lib/ingestion/location";
import { collectInventory, listInventoryFiles, mapInventoryRow, namesFromTreeJson, parseCsv, INVENTORY_RAW_BASE } from "@/lib/ingestion/discovery/ats-inventory";
import { statusForError } from "@/lib/ingestion/discovery/validation";
import { applyUrlStatusFor } from "@/lib/ingestion/verify-urls";
import { candidateFromCcUrl, parseCcLines } from "@/lib/ingestion/discovery/commoncrawl";
import { parseManifest } from "@/lib/ingestion/supplemental/manifest";
import { oracle } from "@/lib/ingestion/providers/oracle";
import { eightfold } from "@/lib/ingestion/providers/eightfold";
import { detectAts } from "@/lib/ingestion/providers/detect";
import { IngestError } from "@/lib/ingestion/types";
import { harness, installFixtures, json } from "./ingestion-test-utils";

const { t, done } = harness();
const cls = (...l: string[]) => classifyLocation(l);
const src = (o: any) => ({ id: null, companySlug: "acme", provider: "oracle" as const, boardSlug: null, tenant: null, host: null, careerSite: null, sourceUrl: null, etag: null, lastModified: null, config: {}, ...o });

async function main() {
  console.log("location: Chennai and strict matching");
  await t("Chennai aliases classify as chennai", () => {
    for (const l of ["Chennai, Tamil Nadu, India", "Chennai", "Madras, India", "Taramani, Chennai", "OMR, Tamil Nadu, India", "Guindy, Tamil Nadu, India", "Sholinganallur, Tamil Nadu, India", "Perungudi, India", "MAA"]) assert.deepEqual(cls(l).cities, ["chennai"], l);
    assert.equal(cls("Chennai").cityClass, "chennai");
  });
  await t("ambiguous names need context: Madras (Oregon), bare OMR, 'maa', Financial District NYC", () => {
    assert.equal(cls("Madras, Oregon, United States").cityClass, "unknown");
    assert.equal(cls("OMR").cityClass, "unknown");
    assert.equal(cls("Maa Durga Foods, Pune").cities.length, 0);
    assert.equal(cls("Financial District, New York, USA").cityClass, "unknown");
    assert.deepEqual(cls("Financial District, Telangana, India").cities, ["hyderabad"]);
  });
  await t("Bengaluru + Hyderabad aliases still work; Hyderabad Sindh and Indianapolis are excluded", () => {
    assert.deepEqual(cls("Bangalore, KA").cities, ["bengaluru"]);
    assert.deepEqual(cls("Bengaluru Urban, Karnataka, India").cities, ["bengaluru"]);
    assert.deepEqual(cls("Gachibowli, Telangana, India").cities, ["hyderabad"]);
    assert.deepEqual(cls("HITEC City, India").cities, ["hyderabad"]);
    assert.equal(cls("Hyderabad, Sindh, Pakistan").cityClass, "unknown");
    assert.equal(cls("Indianapolis, IN").cityClass, "unknown");
  });
  await t("multi-location keeps every real city; blr+hyd stays 'both', with chennai it is 'multi'", () => {
    assert.equal(cls("Bengaluru", "Hyderabad").cityClass, "both");
    const m = cls("Bengaluru", "Hyderabad", "Chennai");
    assert.equal(m.cityClass, "multi"); assert.deepEqual(m.cities, ["bengaluru", "hyderabad", "chennai"]);
    assert.deepEqual(cls("Chennai", "Pune, India").cities, ["chennai"]);
  });
  await t("remote India is NOT an onsite city job; bare Remote says nothing about India", () => {
    const r = classifyLocation(["Remote - India"], "remote");
    assert.equal(r.cityClass, "india_remote"); assert.deepEqual(r.cities, []); assert.equal(r.remoteIndia, true);
    assert.equal(classifyLocation(["Remote"], "remote").cityClass, "unknown");
    const hybrid = classifyLocation(["Chennai (Remote eligible)"], "unknown");
    assert.deepEqual(hybrid.cities, ["chennai"]); assert.equal(hybrid.remoteIndia, true);
  });
  await t("legacy city_class maps to cities", () => { assert.deepEqual(citiesFromClass("both"), ["bengaluru", "hyderabad"]); assert.deepEqual(citiesFromClass("other_india"), []); });

  console.log("inventory: listing, CSV, mapping");
  await t("CSV parser: quotes, escaped quotes, CRLF, BOM, embedded newline", () => {
    const { header, rows } = parseCsv('\uFEFFname,slug,url\r\n"Acme, Inc",acme,https://x\r\n"Say ""hi""\nthere",b,\r\n');
    assert.deepEqual(header, ["name", "slug", "url"]); assert.equal(rows[0]!.name, "Acme, Inc"); assert.equal(rows[1]!.name, 'Say "hi"\nthere'); assert.equal(rows.length, 2);
  });
  await t("tree-page JSON fallback finds CSV entries structurally", () => {
    const body = JSON.stringify({ payload: { codeViewTreeRoute: { tree: { items: [{ name: "greenhouse.csv" }, { name: "README.md" }, { name: "workday.csv" }] } } } });
    assert.deepEqual(namesFromTreeJson(body), ["greenhouse.csv", "workday.csv"]); assert.deepEqual(namesFromTreeJson("<html>"), []);
  });
  await t("listing uses the API when available and falls back to the tree page when it is refused", async () => {
    const api = await listInventoryFiles({ fetchText: async () => ({ status: 200, notModified: false, etag: null, text: JSON.stringify([{ type: "file", name: "lever.csv" }, { type: "dir", name: "x" }, { type: "file", name: "a.txt" }]) }) });
    assert.equal(api.via, "github_api"); assert.deepEqual(api.files.map((f) => f.provider), ["lever"]); assert.ok(api.files[0]!.url.startsWith(INVENTORY_RAW_BASE));
    const fb = await listInventoryFiles({ fetchText: async (u) => { if (u.includes("api.github.com")) throw new IngestError("HTTP 403", "rate_limited", 403); return { status: 200, notModified: false, etag: null, text: JSON.stringify({ items: [{ name: "ashby.csv" }] }) }; } });
    assert.equal(fb.via, "github_tree_page"); assert.equal(fb.files[0]!.provider, "ashby"); assert.ok(fb.notes[0]);
  });
  await t("row mapping: greenhouse/lever/ashby/workday/oracle/keka/darwinbox/eightfold from real URL shapes", () => {
    const c = (p: string, r: Record<string, string>) => { const m = mapInventoryRow(p, r); assert.equal(m.kind, "candidate", `${p} ${JSON.stringify(r)}`); return (m as any).candidate; };
    assert.equal(c("greenhouse", { name: "10Beauty", slug: "10beauty", url: "https://job-boards.greenhouse.io/10beauty" }).boardSlug, "10beauty");
    assert.equal(c("lever", { name: "100MS", slug: "100ms", url: "https://jobs.lever.co/100ms" }).boardSlug, "100ms");
    const w = c("workday", { name: "23Andme", slug: "23andme/23", url: "https://23andme.wd5.myworkdayjobs.com/23" });
    assert.deepEqual([w.tenant, w.host, w.careerSite], ["23andme", "wd5", "23"]);
    const o = c("oracle", { name: "Adara", slug: "x", url: "https://fa-etzd-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001" });
    assert.deepEqual([o.tenant, o.host, o.careerSite], ["fa-etzd-saasfaprod1", "fa.ocs", "CX_1001"]);
    assert.equal(c("keka", { name: "Brew", url: "https://abcoffee.keka.com/careers" }).boardSlug, "abcoffee");
    assert.equal(c("darwinbox", { name: "Airtel", slug: "airtel", url: "https://airtel.darwinbox.in/ms/candidate/careers" }).boardSlug, "airtel");
    const e = c("eightfold", { name: "Albemarle", slug: "albemarle", url: "https://albemarle.eightfold.ai/careers", domain: "albemarle.com" });
    assert.deepEqual([e.boardSlug, e.careerSite], ["albemarle", "albemarle.com"]);
  });
  await t("row mapping never guesses: eightfold without domain, bad slugs, wrong-platform URLs, unsupported platforms", () => {
    assert.deepEqual(mapInventoryRow("eightfold", { name: "X", url: "https://xx.eightfold.ai/careers", domain: "" }), { kind: "invalid", reason: "missing tenant domain (never guessed)" });
    assert.equal(mapInventoryRow("greenhouse", { name: "X", slug: "a/b", url: "" }).kind, "invalid");
    assert.equal(mapInventoryRow("greenhouse", { name: "X", slug: "", url: "" }).kind, "invalid");
    assert.equal(mapInventoryRow("workday", { name: "X", slug: "t/s", url: "https://x.impl-wd502.myworkdayjobs.com/s" }).kind, "invalid"); // sandbox tenant
    assert.equal(mapInventoryRow("icims", { name: "X", slug: "x", url: "https://careers-x.icims.com" }).kind, "unsupported");
    assert.equal((mapInventoryRow("lever", { name: "X", slug: "other", url: "https://jobs.lever.co/real" }) as any).slugMismatch, true); // URL wins, mismatch is counted
  });
  await t("collectInventory: dedupes, counts invalid/unsupported, round-robins platforms, incremental 304", async () => {
    const files: Record<string, string> = {
      "greenhouse.csv": "name,slug,url\nA,a,https://boards.greenhouse.io/a\nA again,A,https://boards.greenhouse.io/a\nB,b,https://boards.greenhouse.io/b\nBad,,\n",
      "darwinbox.csv": "name,slug,url\nD,dbx,https://dbx.darwinbox.in/ms/candidate/careers\n",
      "icims.csv": "name,slug,url\nI,i,https://careers-i.icims.com\n",
    };
    const fetchText = async (u: string, _h?: any, o?: { etag?: string | null }) => {
      const name = decodeURIComponent(u.split("/").pop()!);
      if (o?.etag === "e1") return { status: 304, notModified: true, text: "", etag: "e1" };
      return { status: 200, notModified: false, text: files[name]!, etag: "e1" };
    };
    const listing = { via: "github_api" as const, notes: [], files: Object.keys(files).map((n) => ({ name: n, provider: n.replace(".csv", ""), url: INVENTORY_RAW_BASE + n })) };
    const r = await collectInventory({ listing, fetchText });
    assert.equal(r.totals.candidates, 3); assert.equal(r.totals.duplicates, 1); assert.equal(r.totals.invalid, 1); assert.equal(r.totals.unsupportedByProvider.icims, 1);
    assert.equal(r.candidates[0]!.provider, "darwinbox"); // India-native platform first, then round-robin
    const again = await collectInventory({ listing, fetchText, etags: r.etags });
    assert.equal(again.totals.candidates, 0); assert.equal(again.files.every((f) => f.notModified), true);
  });

  console.log("validation status mapping");
  await t("timeouts and network problems are never 'not_found'", () => {
    assert.equal(statusForError("timeout"), "temporarily_unavailable"); assert.equal(statusForError("network"), "temporarily_unavailable"); assert.equal(statusForError("server_error", 503), "temporarily_unavailable"); assert.equal(statusForError("rate_limited", 429), "temporarily_unavailable");
    assert.equal(statusForError("not_found", 404), "not_found"); assert.equal(statusForError("blocked", 403), "access_restricted"); assert.equal(statusForError("challenge"), "access_restricted");
    assert.equal(statusForError("invalid_json", 200), "invalid_response"); assert.equal(statusForError("bad_response"), "invalid_response");
  });
  await t("application-link probe statuses", () => {
    assert.equal(applyUrlStatusFor(null, 200), "ok"); assert.equal(applyUrlStatusFor({ status: 404 }), "gone"); assert.equal(applyUrlStatusFor({ status: 403 }), "restricted");
    assert.equal(applyUrlStatusFor({ category: "too_large", status: 200 }), "ok"); assert.equal(applyUrlStatusFor({ status: 503 }), "unreachable");
  });

  console.log("Common Crawl + manifest parsing");
  await t("CC JSON-lines + candidate extraction skips plumbing and sandbox tenants", () => {
    assert.equal(parseCcLines('{"url":"https://a"}\nnot json\n{"url":"https://b"}\n').length, 2);
    assert.equal(candidateFromCcUrl("https://boards.greenhouse.io/acme/jobs/123")!.boardSlug, "acme");
    assert.equal(candidateFromCcUrl("https://boards.greenhouse.io/embed/job_app?token=1"), null);
    assert.equal(candidateFromCcUrl("https://foo.impl-wd502.myworkdayjobs.com/site"), null);
    const wd = candidateFromCcUrl("https://acme.wd3.myworkdayjobs.com/en-US/External/job/x")!; assert.deepEqual([wd.tenant, wd.host, wd.careerSite], ["acme", "wd3", "External"]);
    assert.equal(candidateFromCcUrl("https://example.com/x"), null);
  });
  await t("manifest parser reads only what is present", () => {
    const m = parseManifest({ updated_at: "2026-10-31T00:00:00Z", ats_count: 2, stats: { total_jobs: 10, total_companies: 4 }, sources: [{ ats: "greenhouse", rows: 7, url: "https://x/g.csv" }, { ats: "lever", rows: 3 }] });
    assert.equal(m.updatedAt, "2026-10-31T00:00:00Z"); assert.equal(m.totalJobs, 10); assert.equal(m.sources[0]!.rows, 7); assert.equal(m.sources[1]!.url, null);
    const e = parseManifest("garbage"); assert.equal(e.totalJobs, null); assert.equal(e.updatedAt, null);
  });

  console.log("providers: oracle + eightfold (fixtures)");
  await t("detectAts finds oracle and eightfold boards from real URL shapes", () => {
    const o = detectAts("https://ebwg.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX")!; assert.deepEqual([o.provider, o.tenant, o.host, o.careerSite], ["oracle", "ebwg", "fa.us2", "CX"]);
    assert.equal(detectAts("https://albemarle.eightfold.ai/careers")!.provider, "eightfold");
  });
  await t("Oracle: parses requisitions, builds public apply URL, paginates, never guesses tenant", async () => {
    const fx = installFixtures([(u) => u.includes("recruitingCEJobRequisitions") ? json({ items: [{ TotalJobsCount: 2, requisitionList: [{ Id: "101", Title: "Engineer", PrimaryLocation: "Chennai, Tamil Nadu, India", PostedDate: "2026-10-20" }, { Id: "102", Title: "Analyst", PrimaryLocation: "Austin, TX, United States" }] }] }) : null]);
    try {
      const r = await oracle.fetchJobs(src({ tenant: "ebwg", host: "fa.us2", careerSite: "CX" }));
      assert.equal(r.jobs.length, 2); assert.equal(r.complete, true);
      assert.deepEqual(r.jobs[0]!.cities, ["chennai"]); assert.equal(r.jobs[0]!.applyUrl, "https://ebwg.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/101"); assert.ok(r.jobs[0]!.postedAt);
      assert.equal(r.jobs[1]!.cityClass, "unknown");
      await assert.rejects(() => oracle.fetchJobs(src({ tenant: "ebwg", host: "evil.com", careerSite: "CX" })));
    } finally { fx.restore(); }
  });
  await t("Eightfold: India-scoped paging, remote flags, requires the tenant domain", async () => {
    const fx = installFixtures([(u) => u.includes("/api/pcsx/search") ? json({ data: { count: 1, positions: [{ id: 7, displayJobId: "J-7", name: "Data Scientist", standardizedLocations: ["Hyderabad, Telangana, India"], locationFlexibility: "Hybrid", postedTs: 1792000000, positionUrl: "/careers/job/7" }] } }) : null]);
    try {
      const r = await eightfold.fetchJobs(src({ provider: "eightfold", boardSlug: "albemarle", careerSite: "albemarle.com" }));
      assert.equal(r.jobs.length, 1); assert.deepEqual(r.jobs[0]!.cities, ["hyderabad"]); assert.equal(r.jobs[0]!.workplaceType, "hybrid"); assert.equal(r.jobs[0]!.applyUrl, "https://albemarle.eightfold.ai/careers/job/7");
      await assert.rejects(() => eightfold.fetchJobs(src({ provider: "eightfold", boardSlug: "albemarle", careerSite: null })));
    } finally { fx.restore(); }
  });
  done("city supply chain (pure)");
}
main();
