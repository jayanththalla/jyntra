// Integration test for the funding-news store against a REAL PostgreSQL (or PGlite over a socket).
// Run: DATABASE_URL=postgres://… npx tsx scripts/test-news-db.ts   (uses the schema in lib/database/schema.sql; writes only test rows and removes them)
import assert from "node:assert/strict";
if (!process.env.DATABASE_URL) { console.log("SKIPPED: DATABASE_URL is not set, so no database tests were run."); process.exit(0); }

async function main() {
  const { query, ready, pool } = await import("@/lib/database");
  const { upsertArticles, listArticles } = await import("@/lib/news/store");
  await ready();
  await query("DELETE FROM funding_articles WHERE url LIKE 'https://t.example/%'");
  const now = new Date().toUTCString();
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toUTCString();
  let ok = 0; const t = (n: string) => { ok++; console.log("  ✓", n); };

  const r1 = await upsertArticles([
    { url: "https://t.example/inc42/zyro?utm_source=x", headline: "Bengaluru-based Zyro raises $5 Mn in Seed round led by Accel", publisher: "Inc42", publishedAt: now, provider: "rss", summary: "" },
    { url: "https://t.example/ys/zyro-seed", headline: "Zyro bags Rs 42 Cr in seed funding from Accel, Blume", publisher: "YourStory", publishedAt: day(1), provider: "rss" },
    { url: "https://t.example/ys/zyro-seed", headline: "Zyro bags Rs 42 Cr in seed funding from Accel, Blume", publisher: "YourStory", publishedAt: day(1), provider: "rss" },
    { url: "https://t.example/et/lyzr", headline: "Accel leads $20 Mn Series A round in AI startup Lyzr", publisher: "ET", publishedAt: day(2), provider: "rss" },
    { url: "https://t.example/ent/nobroker", headline: "NoBroker in talks to raise $200 Mn", publisher: "Entrackr", publishedAt: day(3), provider: "rss" },
    { url: "https://t.example/inc42/zyro-a", headline: "Zyro raises $30 Mn in Series A", publisher: "Inc42", publishedAt: day(0), provider: "rss" },
  ]);
  assert.equal(r1.inserted, 4, JSON.stringify(r1)); assert.equal(r1.nearDuplicates, 2, JSON.stringify(r1)); // the YourStory story, seen twice, is merged both times but listed once
  t("same raise from another outlet is merged (and a repeated URL is not double counted); a later Series A stays separate");

  const all = await listArticles({ limit: 50, q: "" });
  const zyro = all.articles.find((a) => a.company_name === "Zyro" && a.funding_round === "Seed")!;
  assert.deepEqual(zyro.also_reported.map((x) => x.publisher), ["YourStory"]);
  assert.deepEqual(zyro.investors, ["Accel"]);
  assert.equal(zyro.announcement_kind, "confirmed");
  t("the merged card remembers who else reported it and the investors named");

  const nb = all.articles.find((a) => a.company_name === "NoBroker")!;
  assert.equal(nb.announcement_kind, "planned");
  const lyzr = all.articles.find((a) => a.company_name === "Lyzr")!;
  assert.deepEqual(lyzr.investors, ["Accel"]); assert.equal(lyzr.funding_round, "Series A");
  t("planned raises are labelled; investor-first headlines are parsed");

  const conf = await listArticles({ limit: 50, kind: "confirmed" });
  assert.ok(conf.articles.every((a) => a.announcement_kind === "confirmed") && !conf.articles.some((a) => a.company_name === "NoBroker"));
  t("the confirmed-only filter hides talks and unconfirmed reports");

  // A confirmed report of a previously 'planned' raise upgrades the card instead of duplicating it.
  const r2 = await upsertArticles([{ url: "https://t.example/inc42/nobroker-closed", headline: "NoBroker raises $200 Mn", publisher: "Inc42", publishedAt: now, provider: "rss" }]);
  assert.equal(r2.inserted, 0); assert.equal(r2.nearDuplicates, 1);
  const nb2 = (await listArticles({ limit: 50 })).articles.find((a) => a.company_name === "NoBroker")!;
  assert.equal(nb2.announcement_kind, "confirmed"); assert.equal(nb2.also_reported[0].publisher, "Inc42");
  t("a confirmed report upgrades a planned one");

  // Same story text under a different URL (syndication) merges by fingerprint; GDELT's first-seen time is never a publication date.
  const r3 = await upsertArticles([
    { url: "https://t.example/gd/qb1", headline: "Quillby raises $4 Mn in Seed round led by Blume Ventures", publisher: "site-one.com", provider: "gdelt", seenAt: "2026-10-29T10:00:00.000Z" },
    { url: "https://t.example/gd/qb1-amp", headline: "Quillby Raises $4 Mn In Seed Round Led By Blume Ventures!", publisher: "site-two.com", provider: "gdelt" },
  ]);
  assert.equal(r3.inserted, 1); assert.equal(r3.nearDuplicates, 1);
  const qb = (await listArticles({ limit: 50 })).articles.find((a) => a.company_name === "Quillby")!;
  assert.equal(qb.published_at, null); assert.equal(qb.freshness, "undated"); assert.equal(qb.date_source, null);
  assert.equal(qb.also_reported[0].publisher, "site-two.com");
  const [prov] = await query("SELECT provider_seen_at FROM funding_articles WHERE id = $1", [qb.id]);
  assert.ok(prov.provider_seen_at);
  t("fingerprint dedupe merges copies; provider first-seen is provenance and the card stays 'undated'");

  // Company links come from the matched company record only, with explicit verified/unverified labels.
  await query("INSERT INTO startups (name, normalized_name, website, careers_url, linkedin_url, source, sources_seen) VALUES ('Quillby','quillby','https://quillby.io','https://quillby.io/careers','https://www.linkedin.com/company/quillby','funding_rss','{funding_rss}') ON CONFLICT DO NOTHING");
  await query("UPDATE funding_articles SET startup_id = (SELECT id FROM startups WHERE normalized_name='quillby' LIMIT 1) WHERE id = $1", [qb.id]);
  let withLinks = (await listArticles({ limit: 50 })).articles.find((a) => a.id === qb.id)!;
  assert.equal(withLinks.links.website?.status, "unverified"); assert.equal(withLinks.listed_roles, 0);
  await query("UPDATE startups SET sources_seen = '{funding_rss,yc}' WHERE normalized_name='quillby'");
  withLinks = (await listArticles({ limit: 50 })).articles.find((a) => a.id === qb.id)!;
  assert.equal(withLinks.links.website?.status, "verified"); assert.equal(withLinks.links.linkedin?.status, "verified"); assert.equal(withLinks.links.careers?.status, "verified");
  await query("DELETE FROM startups WHERE normalized_name='quillby'");
  t("links are labelled from the company record; roles are counted separately from the article");

  // ---- verification, city, sector, AI analysis ----
  const { enrichArticles } = await import("@/lib/news/enrich");
  const { analyzeArticle } = await import("@/lib/news/analysis");
  const asked: number[][] = [];
  const rep = await enrichArticles({ classify: async (items) => { asked.push(items.map((i) => i.id)); return new Map(items.filter((i) => /NoBroker/.test(i.headline)).map((i) => [i.id, "proptech"])); } });
  assert.ok(rep.enriched >= 4, JSON.stringify(rep));
  const e1 = (await listArticles({ limit: 50 })).articles;
  const by = (c: string) => e1.find((a) => a.company_name === c && (c !== "Zyro" || a.funding_round === "Seed"))!; // Zyro has a Seed card and a later Series A card
  assert.equal(by("Zyro").city, "bengaluru"); assert.equal(by("Zyro").city_source, "story");
  assert.equal(by("Lyzr").sector, "ai"); assert.equal(by("Lyzr").sector_source, "rules"); assert.equal(by("Lyzr").city, null);
  assert.equal(by("NoBroker").sector, "proptech"); assert.equal(by("NoBroker").sector_source, "ai");
  assert.ok(asked.length === 1 && asked[0].includes(by("NoBroker").id) && !asked[0].includes(by("Lyzr").id), "the model is asked only about stories the rules could not place");
  t("new stories get a city (only from the story) and a sector (rules first, model only for the rest)");

  const again = await enrichArticles({ classify: async () => { throw new Error("must not be called twice"); } });
  assert.equal(again.enriched, 0); assert.equal(again.aiClassified, 0);
  t("enrichment is idempotent: nothing is re-enriched or re-asked");

  assert.equal(by("Zyro").verification, "verified"); assert.equal(by("Zyro").outlets, 2);
  assert.equal(by("Lyzr").verification, "single_source"); assert.equal(by("Lyzr").outlets, 1);
  assert.equal(by("NoBroker").verification, "verified"); // upgraded to confirmed above and also reported by Inc42
  const vf = async (v: "verified" | "single_source" | "unconfirmed") => (await listArticles({ limit: 50, verification: v })).articles.filter((a) => a.url.includes("t.example"));
  assert.ok((await vf("verified")).every((a) => a.verification === "verified" && a.outlets >= 2));
  assert.ok((await vf("single_source")).every((a) => a.verification === "single_source" && a.announcement_kind === "confirmed"));
  assert.ok((await vf("single_source")).some((a) => a.company_name === "Lyzr") && !(await vf("single_source")).some((a) => a.company_name === "Zyro" && a.funding_round === "Seed"));
  assert.ok((await vf("unconfirmed")).every((a) => a.announcement_kind !== "confirmed"));
  t("verification status and its filter agree (2+ publishers = verified; talks are unconfirmed)");

  const inBlr = await listArticles({ limit: 50, city: "bengaluru" });
  assert.ok(inBlr.articles.length >= 1 && inBlr.articles.every((a) => a.city === "bengaluru"));
  const unk = await listArticles({ limit: 50, city: "unknown" });
  assert.ok(unk.articles.some((a) => a.company_name === "Lyzr") && unk.articles.every((a) => a.city === null));
  const secAi = await listArticles({ limit: 50, sector: "ai" });
  assert.ok(secAi.articles.some((a) => a.company_name === "Lyzr") && secAi.articles.every((a) => a.sector === "ai"));
  const combo = await listArticles({ limit: 50, sector: "ai", city: "bengaluru" });
  assert.ok(combo.articles.every((a) => a.sector === "ai" && a.city === "bengaluru"));
  assert.ok(inBlr.facets.cities.some((c) => c.id === "bengaluru") && inBlr.facets.sectors.some((s) => s.id === "ai"));
  t("city, sector ('unknown' included) and combined filters narrow the list; facets list what exists");

  // AI analysis: a fake provider, cached by facts, validated against the story.
  const zid = by("Zyro").id;
  let calls = 0;
  const fakeFetch = (body: object) => (async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }] }), { status: 200 }); }) as unknown as typeof fetch;
  const good = { summary: "Zyro raised a Seed round led by Accel.", why_it_matters: "A seed round points to an early-stage company.", check_next: ["Check the company's own site", "Look for a second report"] };
  const a1 = await analyzeArticle(zid, { groqKey: "k", fetchImpl: fakeFetch(good) });
  assert.equal(a1!.status, "ok"); assert.equal(a1!.analysis!.cached, false); assert.equal(calls, 1);
  const a2 = await analyzeArticle(zid, { groqKey: "k", fetchImpl: fakeFetch(good) });
  assert.equal(a2!.analysis!.cached, true); assert.equal(calls, 1);
  t("analysis is generated once and then served from the cache");

  const lid = by("Lyzr").id;
  const bad = await analyzeArticle(lid, { groqKey: "k", fetchImpl: fakeFetch({ ...good, summary: "Lyzr raised $900 Mn." }) });
  assert.equal(bad!.status, "failed"); assert.equal(bad!.analysis, undefined);
  const [none] = await query("SELECT 1 FROM funding_article_analysis WHERE article_id = $1", [lid]);
  assert.equal(none, undefined);
  t("an answer with an invented figure is refused and never cached");

  const nokey = await analyzeArticle(zid, {});
  assert.equal(nokey!.status, "not_configured");
  assert.equal(await analyzeArticle(2_000_000_000, { groqKey: "k" }), null);
  t("no AI key is a clear 'not configured' state; an unknown story is not found");

  await query("DELETE FROM funding_articles WHERE url LIKE 'https://t.example/%'");
  console.log(`${ok} news database checks passed`);
  await pool().end();
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
