// Unit tests for the historical import logic (no database, no network).
import assert from "node:assert/strict";
import { HISTORICAL_SEED, cleanEmail, classify, dedupeBatch, dedupeKey, mergePatch, normalizeRole, toCandidate } from "@/lib/applications/history";

let passed = 0, failed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 4).join("\n    ")}`); }
}

async function main() {
  console.log("historical import");
  await t("seed holds the 8 given records plus 9 international companies, nothing else", () => {
    assert.equal(HISTORICAL_SEED.length, 17);
    assert.equal(HISTORICAL_SEED.filter((r) => r.region === "international").length, 9);
  });
  await t("'Not provided' and other placeholders never become an email; real addresses are kept lower-cased", () => {
    for (const v of ["Not provided", "n/a", "", "  ", "unknown", null, undefined]) assert.equal(cleanEmail(v as any), null);
    assert.equal(cleanEmail("HR@TheAISchool.co"), "hr@theaischool.co");
    assert.equal(toCandidate({ company: "Cardboard", role: "Product Engineer (Full Stack)", contact: "Not provided" })!.contactEmail, null);
  });
  await t("malformed or injected addresses are rejected", () => {
    for (const v of ["a@b", "a b@c.com", "a@c.com\nbcc:x@y.com", "a@c.com, b@c.com", "<a@c.com>", "x".repeat(260) + "@c.com"]) assert.equal(cleanEmail(v), null, v);
  });
  await t("international companies stage with no role, no contact and no URL (nothing invented)", () => {
    const c = HISTORICAL_SEED.filter((r) => r.region === "international").map((r) => toCandidate(r)!);
    for (const x of c) { assert.equal(x.role, null); assert.equal(x.contactEmail, null); assert.equal(x.jobUrl, null); }
  });
  await t("role normalisation: wording differences collapse, intern vs engineer do not", () => {
    assert.equal(normalizeRole("SDE Intern"), normalizeRole("Software Development Engineer Intern"));
    assert.equal(normalizeRole("Software Developer Intern"), normalizeRole("software engineer  intern"));
    assert.notEqual(normalizeRole("Software Engineer"), normalizeRole("Software Engineer Intern"));
  });
  await t("dedupeKey: company suffixes ignored; job URL (tracking stripped) takes precedence", () => {
    assert.equal(dedupeKey("Kanerika Pvt Ltd", "Software Engineer"), dedupeKey("kanerika", "software engineer"));
    assert.equal(dedupeKey("A", "x", "https://jobs.example.com/1?utm_source=a"), dedupeKey("B", "y", "https://jobs.example.com/1"));
  });
  await t("batch: repeats inside one paste are reported, blanks counted invalid", () => {
    const r = dedupeBatch([{ company: "Chargebee", role: "SDE Intern" }, { company: "chargebee inc", role: "sde intern" }, { company: "  " }, { company: "Chargebee", role: "Product Manager" }]);
    assert.equal(r.candidates.length, 2); assert.deepEqual(r.repeated, ["chargebee inc"]); assert.equal(r.invalid, 1);
  });
  const existing = [{ id: 1, company: "Chargebee", role: "SDE Intern", jobUrl: null }, { id: 2, company: "TVH", role: null, jobUrl: null }];
  await t("same company + same role = duplicate; different role = possible, never auto-merged; other company = new", () => {
    assert.deepEqual(classify(toCandidate({ company: "Chargebee", role: "Software Development Engineer Intern" })!, existing), { kind: "duplicate", matchId: 1 });
    assert.equal(classify(toCandidate({ company: "Chargebee", role: "Product Manager" })!, existing).kind, "possible_duplicate");
    assert.equal(classify(toCandidate({ company: "TVH", role: "AI Engineer Intern" })!, existing).kind, "possible_duplicate");
    assert.equal(classify(toCandidate({ company: "Kanerika", role: "Software Engineer" })!, existing).kind, "new");
  });
  await t("two different URLs at one company with the same title are NOT merged as duplicates", () => {
    const ex = [{ id: 9, company: "Acme", role: "Software Engineer", jobUrl: "https://acme.com/jobs/1" }];
    assert.equal(classify(toCandidate({ company: "Acme", role: "Software Engineer", jobUrl: "https://acme.com/jobs/2" })!, ex).kind, "possible_duplicate");
    assert.equal(classify(toCandidate({ company: "Other", role: "x", jobUrl: "https://acme.com/jobs/1" })!, ex).kind, "duplicate");
  });
  await t("unsafe job URLs are dropped, not stored", () => {
    assert.equal(toCandidate({ company: "A", jobUrl: "javascript:alert(1)" })!.jobUrl, null);
  });
  await t("merge only fills empty fields", () => {
    const c = toCandidate({ company: "TVH", role: "AI Engineer Intern", contact: "jobs.india@tvh.com" })!;
    assert.deepEqual(mergePatch({ contact_email: "keep@tvh.com", role_title: null, record_source: "manual" }, c), { contact_email: "keep@tvh.com", role_title: "AI Engineer Intern", record_source: "manual" });
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main();
