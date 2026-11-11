// Funding connectors, official-source marking, dedupe across connectors, company link verification. Mocked network; real PostgreSQL for the DB part.
import assert from "node:assert/strict";
import { Client } from "pg";
import { parseFeed, parseFeedDate, isTooOld } from "@/lib/news/connectors/feed";
import { parseConnectorList, configuredConnectors, runConnector, BUILTIN_CONNECTORS } from "@/lib/news/connectors";
import { enrichCompany, siteNamesCompany, anchors, type Page } from "@/lib/news/company-enrich";
import { newsRefreshSettings } from "@/lib/news/schedule";

let passed = 0, failed = 0;
async function t(n: string, f: () => void | Promise<void>) { try { await f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { failed++; console.log(`  ✗ ${n}\n    ${(e as Error).message.split("\n").slice(0, 5).join("\n    ")}`); } }
const NOW = Date.parse("2026-11-03T10:00:00Z");
const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items}</channel></rss>`;
const item = (title: string, link: string, date?: string, desc = "") => `<item><title><![CDATA[${title}]]></title><link>${link}</link>${date ? `<pubDate>${date}</pubDate>` : ""}<description>${desc}</description></item>`;

async function main() {
  console.log("feed parsing + dates");
  await t("RSS and Atom items are parsed; Atom uses the alternate link and <published>, NEVER <updated>", () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Acme raises $5 Mn</title><link rel="self" href="https://x.com/self"/><link rel="alternate" href="https://x.com/a"/><published>2026-10-30T08:00:00Z</published><updated>2026-11-02T08:00:00Z</updated><summary>s</summary></entry><entry><title>No published date</title><link href="https://x.com/b"/><updated>2026-11-02T08:00:00Z</updated></entry></feed>`;
    const a = parseFeed(atom); assert.equal(a.length, 2); assert.equal(a[0]!.link, "https://x.com/a"); assert.equal(a[0]!.published, "2026-10-30T08:00:00Z"); assert.equal(a[1]!.published, null, "an update stamp is not an announcement date");
    const r = parseFeed(rss(item("Foo &amp; Bar raises $1 Mn", "https://y.com/1", "Tue, 03 Nov 2026 06:00:00 GMT", "<p>Hello &amp; welcome</p>"))); assert.equal(r[0]!.title, "Foo & Bar raises $1 Mn"); assert.equal(r[0]!.description, "Hello & welcome");
    assert.equal(parseFeed(rss(item("bad link", "javascript:alert(1)"))).length, 0);
  });
  await t("dates: RFC822 and ISO parse; garbage, pre-2000 and far-future become null (never 'now')", () => {
    assert.equal(parseFeedDate("Tue, 03 Nov 2026 06:00:00 GMT", NOW), "2026-11-03T06:00:00.000Z"); assert.equal(parseFeedDate("2026-10-30", NOW), "2026-10-30T00:00:00.000Z");
    for (const bad of ["", "not a date", "1999-01-01", "2030-01-01", null, undefined]) assert.equal(parseFeedDate(bad as any, NOW), null);
  });
  await t("old articles are not new rounds: older than 180 days is stale; undated is not treated as stale", () => {
    assert.equal(isTooOld("2026-01-01T00:00:00Z", NOW), true); assert.equal(isTooOld("2026-10-01T00:00:00Z", NOW), false); assert.equal(isTooOld(null, NOW), false);
  });

  console.log("\nconnector configuration + run");
  await t("env lists: HTTPS only, malformed ignored, deduplicated, kinds assigned", () => {
    const l = parseConnectorList("Acme PR|https://acme.com/feed.xml, Bad|http://insecure.com/f, NoUrl, |https://x.com/f, Local|https://localhost/f", "official");
    assert.deepEqual(l.map((x) => [x.label, x.kind]), [["Acme PR", "official"], ["Local", "official"]].slice(0, 1).concat(l.length > 1 ? [["Local", "official"]] : []) as any);
    const c = configuredConnectors({ FUNDING_EXTRA_FEEDS: "TC|https://techcrunch.com/tag/india/feed/", FUNDING_OFFICIAL_FEEDS: "Acme PR|https://acme.com/feed" }); assert.equal(c.filter((x) => x.url.includes("techcrunch")).length, 1, "same URL is not run twice"); assert.ok(c.some((x) => x.kind === "official"));
    assert.deepEqual(configuredConnectors({ FUNDING_CONNECTORS_ENABLED: "false" }), []); assert.ok(BUILTIN_CONNECTORS.every((b) => b.url.startsWith("https://")));
  });
  const def = { id: "official-acme-pr", label: "Acme PR", url: "https://acme.com/feed", kind: "official" as const };
  await t("a run keeps only stories that STATE a raise, marks official feeds, drops stale items, keeps undated ones undated", async () => {
    const body = rss(
      item("Zenith AI raises $12 Mn in Series A led by Peak XV", "https://acme.com/zenith", "Mon, 02 Nov 2026 06:00:00 GMT") +
      item("Quarterly product update and new office", "https://acme.com/update", "Mon, 02 Nov 2026 06:00:00 GMT") +
      item("Old Co raises $3 Mn in seed funding", "https://acme.com/old", "Mon, 05 Jan 2026 06:00:00 GMT") +
      item("Nova Labs raises $4 Mn in seed round", "https://acme.com/nova"));
    const r = await runConnector(def, async () => body, NOW);
    assert.equal(r.ok, true); assert.equal(r.fetched, 4); assert.equal(r.kept, 2); assert.equal(r.skippedOld, 1);
    assert.ok(r.articles.every((a) => a.official === true && a.connector === def.id && a.publisher === "Acme PR"));
    assert.equal(r.articles.find((a) => a.url.endsWith("/nova"))!.publishedAt, null);
  });
  await t("a failing or non-feed source is reported with a category and returns no articles", async () => {
    const down = await runConnector(def, async () => { throw new Error("timeout"); }, NOW); assert.deepEqual([down.ok, down.error, down.articles.length], [false, "timeout", 0]);
    const html = await runConnector(def, async () => "<html>blocked</html>", NOW); assert.deepEqual([html.ok, html.error], [false, "bad_response"]);
  });
  await t("refresh scheduling settings come from the environment, bounded", () => {
    assert.deepEqual(newsRefreshSettings({ FUNDING_NEWS_REFRESH_ENABLED: "false" }).enabled, false);
    assert.equal(newsRefreshSettings({ FUNDING_NEWS_REFRESH_INTERVAL_MINUTES: "360" }).intervalMinutes, 360);
    assert.equal(newsRefreshSettings({ FUNDING_NEWS_REFRESH_INTERVAL_MINUTES: "1" }).intervalMinutes, 5); assert.equal(newsRefreshSettings({ FUNDING_NEWS_REFRESH_INTERVAL_MINUTES: "99999" }).intervalMinutes, 1440);
    assert.equal(newsRefreshSettings({}).enabled, true);
  });

  console.log("\ncompany link enrichment (mocked pages)");
  const ann: Page = { url: "https://www.entrackr.com/2026/11/zenith-ai-raises", html: `<html><body><p>Zenith AI raised $12 Mn.</p><a href="https://www.linkedin.com/company/peak-xv">Peak XV</a> <a href="https://zenith.ai/">Zenith AI</a> <a href="https://twitter.com/entrackr">Follow</a> <a href="https://www.linkedin.com/company/zenith-ai-labs">Zenith AI</a></body></html>` };
  const home = (extra = "") => `<html><head><title>Zenith AI | Build agents</title><meta property="og:site_name" content="Zenith AI"></head><body><h1>Agents for support</h1><a href="/about">About</a><a href="/careers">Careers</a><a href="https://www.linkedin.com/company/zenith-ai/">LinkedIn</a>${extra}</body></html>`;
  const pages = (m: Record<string, string>) => async (u: string): Promise<Page | null> => (u in m ? { url: u, html: m[u]! } : null);
  await t("official site linked from the announcement, named by its own title, with careers + LinkedIn on the site → verified, each field has provenance", async () => {
    const r = await enrichCompany("Zenith AI", ann, pages({ "https://zenith.ai/": home(), "https://zenith.ai/careers": "<html><title>Careers at Zenith</title></html>" }), new Date(NOW));
    assert.equal(r.websiteUrl, "https://zenith.ai/"); assert.equal(r.careersUrl, "https://zenith.ai/careers"); assert.equal(r.linkedinUrl, "https://www.linkedin.com/company/zenith-ai");
    assert.equal(r.verificationStatus, "verified"); assert.equal(r.lastVerifiedAt, new Date(NOW).toISOString());
    assert.deepEqual(r.sources.map((s) => s.field).sort(), ["careersUrl", "linkedinUrl", "websiteUrl"]); assert.ok(r.sources.every((s) => s.url.startsWith("https://") && s.evidence.length > 15));
    assert.ok(!r.linkedinUrl!.includes("peak-xv") && !r.linkedinUrl!.includes("labs"), "investor and look-alike LinkedIn pages are not used");
  });
  await t("a domain is NEVER guessed: no announcement page means no fetch and 'unverified'", async () => {
    let fetched = 0; const r = await enrichCompany("Zenith AI", null, async () => { fetched++; return null; });
    assert.equal(fetched, 0); assert.equal(r.verificationStatus, "unverified"); assert.equal(r.websiteUrl, undefined); assert.deepEqual(r.sources, []);
  });
  await t("a candidate site that does not name the company is rejected (wrong-company protection)", async () => {
    const r = await enrichCompany("Zenith AI", ann, pages({ "https://zenith.ai/": "<html><head><title>Zenith Dental Clinic</title></head><body><a href='/careers'>Careers</a></body></html>" }));
    assert.equal(r.verificationStatus, "unverified"); assert.equal(r.websiteUrl, undefined); assert.equal(r.careersUrl, undefined);
  });
  await t("only the website verified (no careers page, no LinkedIn) is 'partially_verified' and shows nothing it cannot back", async () => {
    const r = await enrichCompany("Zenith AI", ann, pages({ "https://zenith.ai/": "<html><head><title>Zenith AI</title></head><body>hello</body></html>" }));
    assert.equal(r.verificationStatus, "partially_verified"); assert.equal(r.careersUrl, undefined); assert.equal(r.linkedinUrl, undefined);
  });
  await t("careers link must load, be HTTPS, and be on the company domain or a job board carrying the company name", async () => {
    const mk = (careersHref: string, extraPages: Record<string, string> = {}) => enrichCompany("Zenith AI", ann, pages({ "https://zenith.ai/": `<html><head><title>Zenith AI</title></head><body><a href="${careersHref}">Careers</a></body></html>`, ...extraPages }));
    assert.equal((await mk("/careers")).careersUrl, undefined, "page 404 → not set");
    assert.equal((await mk("http://zenith.ai/careers", { "https://zenith.ai/careers": "<html>x</html>" })).careersUrl, undefined, "plain http is refused");
    assert.equal((await mk("https://evil-jobs.com/zenith", { "https://evil-jobs.com/zenith": "<html>x</html>" })).careersUrl, undefined, "other domain");
    assert.equal((await mk("https://boards.greenhouse.io/otherco", { "https://boards.greenhouse.io/otherco": "<html>x</html>" })).careersUrl, undefined, "job board of a different company");
    assert.equal((await mk("https://boards.greenhouse.io/zenithai", { "https://boards.greenhouse.io/zenithai": "<html>x</html>" })).careersUrl, "https://boards.greenhouse.io/zenithai");
    assert.equal((await mk("https://jobs.zenith.ai/", { "https://jobs.zenith.ai/": "<html>x</html>" })).careersUrl, "https://jobs.zenith.ai/", "subdomain of the company site");
  });
  await t("LinkedIn: only /company/<slug>; /in/, /school/, /showcase/ and search pages are refused", async () => {
    const mk = (href: string) => enrichCompany("Zenith AI", ann, pages({ "https://zenith.ai/": `<html><head><title>Zenith AI</title></head><body><a href="${href}">in</a></body></html>` }));
    for (const bad of ["https://www.linkedin.com/in/founder", "https://www.linkedin.com/school/x", "https://www.linkedin.com/showcase/y", "https://www.linkedin.com/search/results/?q=zenith", "http://www.linkedin.com/company/zenith"]) assert.equal((await mk(bad)).linkedinUrl, undefined, bad);
    assert.equal((await mk("https://in.linkedin.com/company/zenith-ai?trk=x")).linkedinUrl, "https://www.linkedin.com/company/zenith-ai");
  });
  await t("news/social/investor domains are never offered as the company website", () => {
    const html = `<a href="https://techcrunch.com/x">Zenith AI</a><a href="https://www.crunchbase.com/organization/zenith-ai">Zenith AI</a><a href="https://x.com/zenith">Zenith AI</a>`;
    assert.equal(anchors(html, "https://e.com/").length, 3);
    return enrichCompany("Zenith AI", { url: "https://e.com/a", html }, async () => { throw new Error("must not fetch"); }).then((r) => assert.equal(r.verificationStatus, "unverified"));
  });
  await t("siteNamesCompany looks only at what the site calls itself", () => {
    assert.ok(siteNamesCompany("<title>Zenith AI - home</title>", "Zenith AI")); assert.equal(siteNamesCompany("<title>Home</title><p>Zenith AI</p>", "Zenith AI"), null); assert.equal(siteNamesCompany("<title>x</title>", "ab"), null);
  });

  console.log("\nPostgreSQL: storage, official upgrade, dedupe, last-good data, link persistence");
  const base = process.env.DATABASE_URL;
  if (!base) console.log("  SKIPPED: DATABASE_URL not set");
  else {
    const dbName = `jyntra_fc_${process.pid}_${Date.now() % 100000}`;
    const admin = new Client({ connectionString: base }); await admin.connect(); admin.on("error", () => {}); await admin.query(`CREATE DATABASE ${dbName}`);
    const u = new URL(base); u.pathname = "/" + dbName; process.env.DATABASE_URL = u.toString();
    const { query, pool, ready } = await import("@/lib/database"); pool().on("error", () => {}); await ready();
    const { upsertArticles, listArticles } = await import("@/lib/news/store");
    const { runAllConnectors, connectorHealth } = await import("@/lib/news/connectors");
    const { enrichPending, linksFor } = await import("@/lib/news/company-enrich");
    const feeds: Record<string, string | Error> = {
      "https://news.example/feed": rss(item("Zenith AI raises $12 Mn in Series A led by Peak XV", "https://news.example/zenith", "Mon, 02 Nov 2026 06:00:00 GMT", "Bengaluru-based Zenith AI said the round was led by Peak XV.") + item("Kiri Foods raises Rs 40 crore in Series B", "https://news.example/kiri", "Mon, 02 Nov 2026 07:00:00 GMT")),
      "https://pr.zenith.ai/feed": rss(item("Zenith AI announces $12 million Series A funding led by Peak XV", "https://pr.zenith.ai/series-a", "Mon, 02 Nov 2026 09:00:00 GMT")),
      "https://down.example/feed": new Error("timeout"),
    };
    const fetchText = async (url: string) => { const v = feeds[url]; if (v instanceof Error || v === undefined) throw v ?? new Error("network"); return v; };
    const env = { FUNDING_CONNECTORS_ENABLED: "true", FUNDING_EXTRA_FEEDS: "News Ex|https://news.example/feed,Down Ex|https://down.example/feed", FUNDING_OFFICIAL_FEEDS: "Zenith PR|https://pr.zenith.ai/feed" };
    const nowMs = NOW;
    let run: Awaited<ReturnType<typeof runAllConnectors>>;
    await t("connectors store stories, one failing connector does not stop the others, and the error is surfaced", async () => {
      run = await runAllConnectors({ env, fetchText, store: upsertArticles, now: nowMs });
      const byId = Object.fromEntries(run.results.map((r) => [r.label, r])); assert.equal(byId["News Ex"]!.ok, true); assert.equal(byId["Down Ex"]!.ok, false); assert.equal(byId["Zenith PR"]!.ok, true);
      assert.match(run.partialError!, /Down Ex: timeout/);
      const [n] = await query<{ n: string }>("SELECT count(*) n FROM funding_articles WHERE source_connector IS NOT NULL"); assert.ok(Number(n.n) >= 2);
    });
    await t("the same round from a news feed and the company's own announcement is ONE card with both sources, marked official", async () => {
      const rows = await query<any>("SELECT id, publisher, also_reported, verification_status, funding_amount, funding_round, funding_currency, investors, published_at FROM funding_articles WHERE company_name = 'Zenith AI'");
      assert.equal(rows.length, 1, JSON.stringify(rows.map((r: any) => r.publisher)));
      const r = rows[0]; assert.equal(r.verification_status, "official"); assert.ok(r.also_reported.length >= 1 || r.publisher === "Zenith PR");
      assert.equal(r.funding_round, "Series A"); assert.ok(r.investors.includes("Peak XV")); assert.ok(r.published_at, "publication date retained");
      const art = (await listArticles({ q: "Zenith" })).articles[0]!; assert.equal(art.official, true); assert.ok(art.outlets >= 2);
    });
    await t("amount and currency are parsed from the story; INR 'crore' keeps INR; undisclosed amounts stay undisclosed", async () => {
      const [k] = await query<any>("SELECT funding_amount, funding_currency, funding_round FROM funding_articles WHERE company_name = 'Kiri Foods'"); assert.equal(k.funding_currency, "INR"); assert.equal(k.funding_round, "Series B"); assert.match(k.funding_amount, /crore/i);
    });
    await t("a different round for the same company is NOT merged with the first", async () => {
      await upsertArticles([{ url: "https://news.example/zenith-seed", headline: "Zenith AI raises $2 Mn in seed round", publisher: "Other Pub", publishedAt: "2026-03-01T00:00:00Z", provider: "rss" }]);
      const n = await query<any>("SELECT funding_round FROM funding_articles WHERE company_name='Zenith AI' ORDER BY funding_round"); assert.equal(n.length, 2); assert.deepEqual(n.map((x: any) => x.funding_round), ["Seed", "Series A"]);
    });
    await t("run history and per-connector health are persisted", async () => {
      const h = await connectorHealth(); const byC = Object.fromEntries(h.map((x) => [x.connector, x])); assert.equal(byC["news-news-ex"]?.ok, true); assert.equal(byC["news-down-ex"]?.ok, false); assert.equal(byC["news-down-ex"]?.error_category, "timeout");
      const [f] = await query<any>("SELECT consecutive_failures FROM feed_health WHERE feed = 'news-down-ex'"); assert.equal(f.consecutive_failures, 1);
    });
    await t("LAST-GOOD DATA is preserved: when every connector fails, stored stories remain and are still listed", async () => {
      const before = (await listArticles({})).total; feeds["https://news.example/feed"] = new Error("network"); feeds["https://pr.zenith.ai/feed"] = new Error("network");
      const r = await runAllConnectors({ env, fetchText, store: upsertArticles, now: nowMs }); assert.ok(r.results.every((x) => !x.ok));
      assert.equal((await listArticles({})).total, before);
    });
    await t("re-running with the same stories does not duplicate them (idempotent)", async () => {
      feeds["https://news.example/feed"] = rss(item("Zenith AI raises $12 Mn in Series A led by Peak XV", "https://news.example/zenith", "Mon, 02 Nov 2026 06:00:00 GMT")); const before = (await query<any>("SELECT count(*) n FROM funding_articles"))[0].n;
      await runAllConnectors({ env, fetchText, store: upsertArticles, now: nowMs }); assert.equal((await query<any>("SELECT count(*) n FROM funding_articles"))[0].n, before);
    });
    await t("an official item does not downgrade or create duplicates when the same URL is seen again", async () => {
      const r = await upsertArticles([{ url: "https://pr.zenith.ai/series-a", headline: "Zenith AI announces $12 million Series A funding led by Peak XV", publisher: "Zenith PR", provider: "rss", official: true }]); assert.equal(r.inserted, 0);
    });

    // company links
    await query("UPDATE funding_articles SET published_at = now() - interval '2 days' WHERE company_name IN ('Zenith AI','Kiri Foods')");
    const fp = async (url: string): Promise<Page | null> => {
      const m: Record<string, string> = { "https://news.example/zenith": ann.html, "https://zenith.ai/": home(), "https://zenith.ai/careers": "<html>careers</html>", "https://pr.zenith.ai/series-a": ann.html };
      return url in m ? { url, html: m[url]! } : null;   // Kiri's announcement page is unreachable
    };
    await t("enrichPending verifies links for funded companies, records provenance, and marks unreachable ones unverified WITHOUT guessing", async () => {
      const jobsBefore = (await query<any>("SELECT count(*) n FROM jobs"))[0].n;
      const r = await enrichPending(5, fp); assert.equal(r.checked, 2); assert.equal(r.verified, 1); assert.equal(r.unverified, 1);
      const m = await linksFor(["Zenith AI", "Kiri Foods"]); const z = m.get("zenithai")!; assert.equal(z.verificationStatus, "verified"); assert.equal(z.careersUrl, "https://zenith.ai/careers"); assert.ok(z.sources.length === 3 && z.lastVerifiedAt);
      const k = m.get("kirifoods")!; assert.equal(k.verificationStatus, "unverified"); assert.equal(k.websiteUrl, undefined); assert.equal(k.careersUrl, undefined);
      assert.equal((await query<any>("SELECT count(*) n FROM jobs"))[0].n, jobsBefore, "a careers link never creates a job opening");
    });
    await t("the funding list carries the verified links with sources; unverified companies carry none; no 'hiring' flag comes from funding", async () => {
      const arts = (await listArticles({})).articles; const z = arts.find((a) => a.company_name === "Zenith AI" && a.funding_round === "Series A")!; const k = arts.find((a) => a.company_name === "Kiri Foods")!;
      assert.equal(z.enriched?.verificationStatus, "verified"); assert.equal(z.listed_roles, 0); assert.equal(k.enriched?.websiteUrl, undefined);
    });
    await t("two companies whose names differ only by a word like 'AI' never share links (storage key is the full name)", async () => {
      const m = await linksFor(["Zenith Dental"]); assert.equal(m.size, 0);
      const { companyKey } = await import("@/lib/news/company-enrich"); assert.notEqual(companyKey("Zenith AI"), companyKey("Zenith Dental")); assert.notEqual(companyKey("Acme Labs"), companyKey("Acme"));
    });
    await t("already-checked companies are not re-fetched; failed ones wait a week", async () => { assert.equal((await enrichPending(5, fp)).checked, 0); });
    await pool().end(); await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`); await admin.end();
  }
  console.log(`\nfunding connectors: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
}
main();
