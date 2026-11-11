// Open-source difficulty, freshness and collection rules. No network, no database. Run: npx tsx scripts/test-oss-filters.ts
import assert from "node:assert/strict";
import { COLLECTIONS, collectionRepoQuery, difficultyOf, updatedWithin } from "@/lib/oss/filters";

let passed = 0;
function t(name: string, fn: () => void) { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { process.exitCode = 1; console.error(`  ✗ ${name}\n    ${(e as Error).message}`); } }

t("a beginner label with a quiet thread is beginner-friendly, and the basis is stated", () => {
  const d = difficultyOf({ issue_labels: ["Good First Issue"], issue_comments: 1 })!;
  assert.equal(d.level, "easy"); assert.ok(d.basis.length > 10);
});
t("a beginner label on a long thread is only 'needs context'", () => assert.equal(difficultyOf({ issue_labels: ["good first issue"], issue_comments: 9 })!.level, "moderate"));
t("advanced labels win over a beginner label; help wanted alone is moderate", () => {
  assert.equal(difficultyOf({ issue_labels: ["good first issue", "advanced"], issue_comments: 0 })!.level, "hard");
  assert.equal(difficultyOf({ issue_labels: ["help wanted"], issue_comments: 0 })!.level, "moderate");
});
t("no evidence means no rating (never a guess)", () => assert.equal(difficultyOf({ issue_labels: ["bug", "ui"], issue_comments: 0 }), null));
t("freshness: inside the window passes, outside fails, undated fails any window but passes 'any'", () => {
  const now = Date.parse("2026-11-03T00:00:00Z");
  assert.ok(updatedWithin("2026-10-30T00:00:00Z", 7, now)); assert.ok(!updatedWithin("2026-09-01T00:00:00Z", 30, now));
  assert.ok(!updatedWithin(null, 90, now)); assert.ok(updatedWithin(null, null, now));
});
t("collection queries are built from GitHub topics/orgs only and keep repos active", () => {
  assert.deepEqual(COLLECTIONS.map((c) => c.id), ["gssoc", "mlh", "cncf", "apache"]);
  const q = collectionRepoQuery(COLLECTIONS[0], "2026-10-01");
  assert.ok(q.includes("topic:gssoc") && q.includes("archived:false") && q.includes("pushed:>=2026-10-01"));
  assert.ok(collectionRepoQuery(COLLECTIONS[3], "2026-10-01").includes("org:apache"));
  assert.ok(COLLECTIONS.every((c) => /^https:\/\//.test(c.url) && c.basis.includes("GitHub")));
});
console.log(`\n${passed} open-source filter checks passed`);
