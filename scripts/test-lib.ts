// Unit checks for the deterministic logic (no network, no DB). Run: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeName, domainOf } from "@/lib/deduplication";
import { parseRemote, locationTags } from "@/lib/jobs/location";
import { jobLevel, matchJob } from "@/lib/matching";
import { classifyStartup } from "@/lib/classification";
import { parseFundingHeadline, fundingStatus, isNewStartup, ycBatchFundingDate, parseAmount, toUsd, fundingStage, consolidateFunding, announcementKind, isRecentYcBatch } from "@/lib/funding";
import { countryFromLocation, countryFromCode } from "@/lib/country";
import { applyFilters, DEFAULT_FILTERS } from "@/lib/filters";
import { emailLabel } from "@/lib/emails/labels";
import { NOT_A_RAISE } from "@/lib/news/feeds";
import { approxUsd, sameRaise } from "@/lib/news/dedupe";
import { hqFromArticle } from "@/sources/funding";
import { himalayasJob } from "@/sources/jobs/himalayas";
import { pickSuggestedIssue, beginnerIssueQuery } from "@/sources/oss";
import { generateQueries } from "@/lib/discovery/queries";
import { roleCategories } from "@/lib/jobs/roles";
import { classifyEmail, contactLink, extractEmails } from "@/lib/emails";
import { parseResumeText } from "@/lib/resume/parse";
import { rateLimit } from "@/lib/rate-limit";
import { isJobBeyondListedWindow, jobAgeDays, jobRecency, inPostedWindow, newestOrder } from "@/lib/jobs/age";
import { fundedRecentlyEnough } from "@/lib/discovery/store";
import { careersLink, jobPostingsFromJsonLd } from "@/sources/company";
import { canonicalUrl } from "@/lib/url";
import { mapToStartup, freshRoles, cityOf } from "@/sources/startupmaps";
import { isSameJob } from "@/lib/jobs/dedupe";
import { jobEvidence, companyEvidence, fitReasons, missingInfo, checkedAgo } from "@/lib/jobs/evidence";
import { dedupeStories, headlineSimilarity } from "@/lib/news/dedupe";
import type { CandidateProfile } from "@/lib/types";

const profile: CandidateProfile = JSON.parse(fs.readFileSync("config/candidate_profile.json", "utf8"));
let passed = 0;
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

console.log("dedup");
t("legal suffixes stripped", () => assert.equal(normalizeName("Foo Technologies Pvt. Ltd."), "foo"));
t("ai suffix stripped", () => assert.equal(normalizeName("Bolna AI"), normalizeName("bolna.ai")));
t("domain", () => assert.equal(domainOf("https://www.Example.com/careers"), "example.com"));
t("linkedin is not a company domain", () => assert.equal(domainOf("https://linkedin.com/company/x"), null));

console.log("location / remote");
t("Pune onsite", () => {
  const r = parseRemote("Mumbai, MH, IN / Pune, MH, IN");
  assert.equal(r.remote, "no");
  assert.ok(locationTags("Mumbai, MH, IN / Pune, MH, IN", r.remote, r.scope).includes("Pune"));
});
t("Remote (IN)", () => {
  const r = parseRemote("Remote (IN)");
  assert.deepEqual(r, { remote: "yes", scope: "India" });
  assert.ok(locationTags("Remote (IN)", r.remote, r.scope).includes("Remote - India"));
});
t("Remote (US) is not India", () => {
  const r = parseRemote("San Francisco, CA, US / Remote (US)");
  assert.equal(r.scope, "US");
  const tags = locationTags("San Francisco, CA, US / Remote (US)", r.remote, r.scope);
  assert.ok(!tags.includes("Remote - India") && !tags.includes("Remote"), tags.join());
});
t("no location → unknown, not remote", () => assert.equal(parseRemote(null).remote, "unknown"));
t("Remote (PT; GB) is restricted, not India", () => assert.deepEqual(parseRemote("PT / GB / Remote (PT; GB)"), { remote: "yes", scope: "PT, GB" }));
t("IN, US is Indiana, not India", () => assert.equal(parseRemote("Remote (SC, US; IN, US; NJ, US)").scope, "US"));
t("Remote (Bengaluru, KA, IN) is India", () => assert.equal(parseRemote("Bengaluru, KA, IN / Remote (Bengaluru, KA, IN)").scope, "India"));
t("bare Remote has unknown region", () => assert.deepEqual(parseRemote("Remote / Remote"), { remote: "yes", scope: null }));

console.log("matching");
const base = { skills: [], description: null, min_experience: null, location: null, remote_scope: null, location_tags: [] as string[] };
t("backend Node role in Pune scores strong", () => {
  const m = matchJob({ ...base, job_title: "Backend Engineer", skills: ["Node.js", "MongoDB", "AWS"], location: "Pune, MH, IN", location_tags: ["Pune", "India"], min_experience: "0-1 years" }, profile);
  assert.equal(m.role_match.level, "strong");
  assert.ok(m.matched_skills.includes("Node.js") && m.matched_skills.includes("MongoDB"));
  assert.ok(m.missing_skills.includes("AWS"));
  assert.equal(m.relevance, "strong", JSON.stringify(m));
});
t("sales role not relevant", () => assert.equal(matchJob({ ...base, job_title: "Sales Manager" }, profile).relevance, "not_relevant"));
t("HR not relevant", () => assert.equal(matchJob({ ...base, job_title: "HR Executive" }, profile).relevance, "not_relevant"));
t("senior role penalised", () => {
  const m = matchJob({ ...base, job_title: "Senior Frontend Engineer", skills: ["React", "TypeScript"], location: "Remote", location_tags: ["Remote"] }, profile);
  assert.equal(m.experience_match.level, "too_senior");
  assert.equal(m.relevance, "low");
  assert.ok(m.cap_reason);
});
t("job outside your locations is low relevance even with great skills", () => {
  const m = matchJob({ ...base, job_title: "Software Engineer", skills: ["TypeScript"], location: "PT / GB / Remote (PT; GB)", remote_scope: "PT, GB", location_tags: ["Remote", "Other"] }, profile);
  assert.equal(m.location_match.level, "none");
  assert.equal(m.relevance, "low");
});
t("AI intern fits", () => {
  const m = matchJob({ ...base, job_title: "AI/ML Intern", skills: ["Python", "LLM"] }, profile);
  assert.equal(m.experience_match.level, "fits");
  assert.equal(m.role_match.level, "strong");
});
t("skills not in profile are never 'matched'", () => {
  const m = matchJob({ ...base, job_title: "Software Engineer", skills: ["Java", "Kubernetes"] }, profile);
  assert.deepEqual(m.matched_skills, []);
});
t("'10+ years' is not mistaken for fresher", () => {
  const m = matchJob({ ...base, job_title: "Software Engineer", min_experience: "10+ years" }, profile);
  assert.equal(m.experience_match.level, "too_senior");
  assert.equal(jobLevel("Software Engineer", "10+ years", null), "experienced");
});

console.log("experience level");
t("intern / fresher titles", () => {
  assert.equal(jobLevel("Software Engineering Intern", null, null), "fresher");
  assert.equal(jobLevel("Backend Developer", "0-1 years", null), "fresher");
  assert.equal(jobLevel("Backend Developer", "Freshers welcome", null), "fresher");
});
t("years asked", () => {
  assert.equal(jobLevel("Backend Developer", "1+ years", null), "fresher");
  assert.equal(jobLevel("Backend Developer", "2-4 years", null), "junior");
  assert.equal(jobLevel("Backend Developer", null, "You have 5+ years of experience with Node"), "experienced");
});
t("senior titles and unknown", () => {
  assert.equal(jobLevel("Senior Backend Engineer", null, null), "experienced");
  assert.equal(jobLevel("Backend Engineer", null, null), "unknown");
});

console.log("classification");
t("AI-first company", () => {
  const c = classifyStartup({ name: "Bolna AI", description: "Bolna is a voice AI platform. Build AI voice agents that call customers.", tags: ["Artificial Intelligence", "Voice AI"], industryHint: "B2B" });
  assert.equal(c.is_ai, true);
  assert.equal(c.classification_confidence, "high");
});
t("single AI mention is not an AI startup", () => {
  const c = classifyStartup({ name: "Kodo", description: "Corporate card & spend management platform for Indian startups. We use some AI for receipts.", tags: ["Fintech"], industryHint: "Fintech" });
  assert.equal(c.is_ai, false);
  assert.equal(c.industry, "FinTech");
});
t("no info → unknown", () => assert.equal(classifyStartup({ name: "X", description: null, tags: [], industryHint: null }).is_ai, null));

console.log("country, amounts, verification, filters, new sources");
t("country from location text and codes", () => {
  assert.equal(countryFromLocation("Bengaluru, KA, IN"), "India");
  assert.equal(countryFromLocation("Indianapolis, IN, US"), "United States");
  assert.equal(countryFromLocation("San Francisco, CA, US"), "United States");
  assert.equal(countryFromLocation("Paris, France"), null);
  assert.equal(countryFromCode("in"), "India");
});
t("amounts parse and convert", () => {
  assert.deepEqual(parseAmount("₹100 Cr"), { value: 1e9, currency: "INR" });
  assert.equal(parseAmount("$42M")?.value, 42e6);
  assert.equal(toUsd(parseAmount("₹830 Cr"), { INR: 83 }), 100_000_000);
  assert.equal(toUsd(parseAmount("₹10 Cr"), null), null);
});
t("funding stage and announcement kind", () => {
  assert.equal(fundingStage("Series A"), "series_a");
  assert.equal(fundingStage("Pre-Seed"), "pre_seed");
  assert.equal(announcementKind("Foo in talks to raise $20M"), "planned");
  assert.equal(announcementKind("Foo raises $5M"), "confirmed");
  assert.equal(announcementKind("Foo reportedly raises $5M"), "rumored");
});
t("confirmed report beats planned; second outlet verifies", () => {
  const base = { investors: [], currency: "USD" as const, amount_value: 5e6, amount_usd: 5e6, round: "Seed", amount: "$5M" };
  const c = consolidateFunding([
    { ...base, source: "A", url: "u1", date: "2026-10-01", kind: "confirmed" },
    { ...base, source: "B", url: "u2", date: "2026-10-02", kind: "confirmed" },
    { ...base, source: "C", url: "u3", date: "2026-10-10", kind: "planned" },
  ]);
  assert.equal(c.primary?.kind, "confirmed");
  assert.ok(c.verification_url);
  assert.equal(c.announcement_date, "2026-10-01");
});
t("hq from article headline", () => {
  assert.equal(hqFromArticle("Bengaluru", null, "Inc42", "u")?.country, "India");
  assert.equal(hqFromArticle(null, "₹50 Cr", "ET", "u")?.confidence, "low");
  assert.equal(hqFromArticle(null, "$5M", "TC", "u"), null);
});
t("YC batch recency covers the current year", () => {
  assert.equal(isRecentYcBatch("Y Combinator Winter 2026", new Date("2026-10-24")), true);
  assert.equal(isRecentYcBatch("Y Combinator Summer 2021", new Date("2026-10-24")), false);
});
t("email labels", () => {
  assert.equal(emailLabel({ email: "careers@x.com", type: "careers" }), "Careers");
  assert.equal(emailLabel({ email: "hr@x.com", type: "general" }), "Hiring");
  assert.equal(emailLabel({ email: "hello@x.com", type: "general" }), "General contact");
});
t("Himalayas job: India-open; keeps older-but-listed roles, drops postings beyond 90 days", () => {
  const now = new Date("2026-10-24");
  const j = { title: "Dev", companyName: "X", pubDate: Math.floor(new Date("2026-10-22").getTime() / 1000), guid: "https://himalayas.app/j/1", locationRestrictions: ["India"] };
  assert.equal(himalayasJob(j, now)?.remoteScope, "India");
  assert.equal(himalayasJob({ ...j, locationRestrictions: ["Brazil"] }, now), null);
  assert.notEqual(himalayasJob({ ...j, pubDate: Math.floor(new Date("2026-10-10").getTime() / 1000) }, now), null); // 14 days: still findable
  assert.equal(himalayasJob({ ...j, pubDate: Math.floor(new Date("2026-06-01").getTime() / 1000) }, now), null); // ~5 months: dropped
});
t("open source: suggested issue prefers good-first-issue, then fewest comments", () => {
  const i = (n: string, labels: string[], comments: number) => ({ title: n, html_url: n, repository_url: "x/repos/a/b", labels: labels.map((name) => ({ name })), comments, updated_at: "2026-10-01" });
  assert.equal(pickSuggestedIssue([i("a", ["help wanted"], 0), i("b", ["good first issue"], 5), i("c", ["good first issue"], 1)]).title, "c");
  assert.match(beginnerIssueQuery(["o1", "o2"], "2026-01-01"), /user:o1 user:o2/);
});
t("country filter hides unknown HQ once chosen", () => {
  const s = (hq: any) => ({ hq_country: hq, jobs: [], location_tags: ["Unknown"], is_fresh: true, is_ai: null, emails: [], relevance: "low", relevant_jobs: 0, best_match: 0, age_bucket: "new", first_discovered_at: "2026-10-01", name: "n", description: null, industry: null, categories: [] }) as any;
  const f = { ...DEFAULT_FILTERS, view: "all" as const, hiringOnly: false, locations: [], country: "india" as const };
  assert.equal(applyFilters([s("India"), s("United States"), s(null)], f).length, 1);
});

console.log("funding");
t("₹ crore headline", () => {
  const f = parseFundingHeadline("Seeds Fincap Raises ₹100 Cr To Scale Lending Tech Capabilities");
  assert.equal(f?.company, "Seeds Fincap");
  assert.equal(f?.amount, "₹100 Cr");
});
t("descriptor stripped", () => assert.equal(parseFundingHeadline("Home Interior Startup Gravity Nets $15 Mn To Expand")?.company, "Gravity"));
t("round + investors", () => {
  const f = parseFundingHeadline("Pune-based AI startup Foo raises $3 Mn in Series A led by Accel and Elevation Capital");
  assert.equal(f?.company, "Foo");
  assert.equal(f?.round, "Series A");
  assert.equal(f?.locationHint, "Pune");
  assert.deepEqual(f?.investors, ["Accel", "Elevation Capital"]);
});

// Realistic headline corpus (Inc42 / Entrackr / YourStory / ET / TechCrunch styles): [headline, expected company or null = not a startup raise].
t("funding headlines: 38-headline corpus (company extraction, investor-first, ranges, IPO, roundups, descriptors)", () => {
  const C: [string, string | null][] = [
  ["Bengaluru-based Zyro raises $5 Mn in Seed round led by Accel", "Zyro"],
  ["Fintech startup Kreditbee bags Rs 150 Cr from Premji Invest", "Kreditbee"],
  ["Vegrow secures $22 Mn in Series B funding", "Vegrow"],
  ["Entrackr Exclusive: Zepto raises ₹3,000 Cr in fresh funding", "Zepto"],
  ["Pune-based Ultrahuman raises $35 Mn Series B led by Nexus", "Ultrahuman"],
  ["Accel leads $20 Mn Series A round in AI startup Lyzr", "Lyzr"],
  ["Peak XV backs Chennai-based Kovai.co with $10 Mn", "Kovai.co"],
  ["Sequoia invests $12 Mn in logistics startup Shiprocket", "Shiprocket"],
  ["Foo attracts $8 Mn in pre-Series A funding", "Foo"],
  ["Rapido pockets $120 Mn from WestBridge", "Rapido"],
  ["AI startup Sarvam raises $41 million to build Indian LLMs", "Sarvam"],
  ["Meesho-backed Zoom raises $50-60 Mn", "Zoom"],
  ["Indian startups raised $120 Mn this week: Funding Galore", null],
  ["Funding Galore: Indian startups raise $85 Mn this week", null],
  ["Swiggy shares jump 5% after Q2 results", null],
  ["Zomato acquires Blinkit for $568 Mn", null],
  ["Info Edge launches Rs 1,000 Cr fund for startups", null],
  ["Bessemer raises $350 Mn for India fund", null],
  ["Why startups raise money in a down market", null],
  ["How to raise your Series A: lessons from 10 founders", null],
  ["Startup X raises the bar for UX", null],
  ["Ola Electric IPO subscribed 4x on day one", null],
  ["Mumbai-based Dezerv raises Rs 238 Cr in Series C round", "Dezerv"],
  ["Hyderabad's Skyroot Aerospace secures $27.5 Mn in funding", "Skyroot Aerospace"],
  ["Gurugram-based NoBroker in talks to raise $200 Mn", "NoBroker"],
  ["Reportedly, Cred is raising $75 Mn at lower valuation", null],
  ["Lenskart raises $200 Mn from Temasek ahead of IPO", "Lenskart"],
  ["Fashinza raises $40M in debt and equity", "Fashinza"],
  ["Spinny gets $131 Mn from Fundamentum, Avenir", "Spinny"],
  ["Digit Insurance mops up Rs 1,000 Cr in pre-IPO round", "Digit Insurance"],
  ["Inc42 Daily Brief: Startup funding up 12%", null],
  ["Climate-tech startup Varaha raises $8.7 Mn in Series A funding", "Varaha"],
  ["Techstars-backed Pixxel closes $24 Mn Series B", "Pixxel"],
  ["Superhero startup Marvel raises $2 in seed", null],
  ["Healthtech startup Even Healthcare raises Rs 100 crore", "Even Healthcare"],
  ["YC-backed Composio raises $25 Mn Series A led by Lightspeed", "Composio"],
  ["Nvidia-backed Krutrim raises ₹500 crore", "Krutrim"],
  ["Foodtech major Rebel Foods raises $50 Mn", "Rebel Foods"],
  ];
  const bad: string[] = [];
  for (const [h, exp] of C) {
    const r = parseFundingHeadline(h);
    const got = r && !NOT_A_RAISE.test(h) ? r.company : null;
    if (got !== exp) bad.push(`${h} -> ${got} (wanted ${exp})`);
  }
  assert.deepEqual(bad, []);
});
t("funding amounts: ranges use the midpoint, units set the currency", () => {
  assert.deepEqual(parseAmount("$50-60 Mn"), { value: 55e6, currency: "USD" });
  assert.deepEqual(parseAmount("Rs 40 to 50 Cr"), { value: 450e6, currency: "INR" });
  assert.deepEqual(parseAmount("₹3,000 Cr"), { value: 30e9, currency: "INR" });
});
t("same raise in two outlets is recognised; a different round is not", () => {
  const a = { company: "Zyro", usd: approxUsd(5e6, "USD"), stage: "seed", at: "2026-10-01T00:00:00Z" };
  assert.ok(sameRaise(a, { company: "ZYRO", usd: approxUsd(420e6, "INR"), stage: "seed", at: "2026-10-02T00:00:00Z" }), "5M USD ~ 42 Cr INR");
  assert.ok(!sameRaise(a, { ...a, stage: "series_a" }));
  assert.ok(!sameRaise(a, { ...a, usd: 20e6 }));
  assert.ok(!sameRaise(a, { ...a, at: "2026-06-01T00:00:00Z" }));
  assert.ok(!sameRaise(a, { ...a, company: "Zyra" }));
  assert.ok(sameRaise({ ...a, usd: null }, { ...a, usd: null }), "no amount: same stage + date is enough");
});
t("non-funding headline rejected", () => assert.equal(parseFundingHeadline("Startup X raises the bar for UX"), null));
t("people descriptions are not company names", () => {
  assert.equal(parseFundingHeadline("Two Google alumni raise $11.3M for their startup"), null);
  assert.equal(parseFundingHeadline("Ex-Tesla team raises $12.5M seed round"), null);
});
t("'X-backed' prefix stripped", () => assert.equal(parseFundingHeadline("a16z-backed EliseAI raises $350M Series E")?.company, "EliseAI"));
t("industry from YC taxonomy beats description keywords", () => {
  const c = classifyStartup({ name: "ZiffyHomes", description: "Managed housing for students and young professionals.", tags: ["Real Estate"], industryHint: "Real Estate and Construction -> Housing and Real Estate" });
  assert.equal(c.industry, "Other");
});
t("'AI-Enhanced Learning' tag alone is not an AI startup", () => {
  const c = classifyStartup({ name: "Kids Coding", description: "Online coding classes for kids.", tags: ["Education", "AI-Enhanced Learning"], industryHint: "Education" });
  assert.equal(c.is_ai, false);
});
t("job age from YC-style and ISO dates", () => {
  const now = new Date("2026-10-12");
  assert.equal(jobAgeDays("3 days ago", now), 3);
  assert.equal(jobAgeDays("about 1 month ago", now), 30);
  assert.equal(jobAgeDays("over 4 years ago", now), 1460);
  assert.equal(jobAgeDays("about an hour ago", now), 1 / 24);
  assert.equal(Math.round(jobAgeDays("2026-09-12", now)!), 30);
  assert.equal(jobAgeDays(null, now), null);
  // ingestion guard: only DATED postings beyond the listed window (90 days) are dropped
  assert.equal(isJobBeyondListedWindow("almost 2 years ago", now), true);
  assert.equal(isJobBeyondListedWindow("5 months ago", now), true);
  assert.equal(isJobBeyondListedWindow("3 weeks ago", now), false); // older than 7 days but still listed: kept
  assert.equal(isJobBeyondListedWindow("2026-10-01", now), false);
  assert.equal(isJobBeyondListedWindow(null, now), false); // undated is kept, never dropped by guessing
});
t("only recently funded startups are added", () => {
  const now = new Date();
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString().slice(0, 10);
  const r = (funding: any) => ({ name: "X", source: "funding_rss", sourceUrl: "u", funding }) as any;
  assert.equal(fundedRecentlyEnough(r({ date: ago(20), round: "Seed", investors: [] }), now), true);
  assert.equal(fundedRecentlyEnough(r({ date: ago(400), round: "Seed", investors: [] }), now), false);
  assert.equal(fundedRecentlyEnough(r({ date: null, round: "Y Combinator Winter 2019", investors: [] }), now), false);
  assert.equal(fundedRecentlyEnough(r(null), now), false);
});
t("Hyderabad GitHub dataset entries map to startups", () => {
  assert.equal(cityOf("Bellandur, Bengaluru, Karnataka 560103"), "Bengaluru");
  assert.equal(cityOf("Gachibowli, Hyderabad, Telangana 500032"), "Hyderabad");
  const now = new Date("2026-10-28T10:00:00Z");
  const base = { id: "acquink", name: " Acquink ", website: "https://acquink.com", oneLiner: "Voice intelligence", description: "NLP platform", address: "Banjara Hills, Hyderabad", area: "Banjara Hills", fundingStage: "Seed", sector: "AI / DeepTech", founded: 2021, status: "approved" };
  const r = mapToStartup(base, now);
  assert.equal(r.name, "Acquink");
  assert.equal(r.website, "https://acquink.com");
  assert.equal(r.description, "Voice intelligence");
  assert.equal(r.foundedYear, 2021);
  assert.equal(r.source, "startupmaps");
  assert.equal(r.hq?.country, "India");
  assert.deepEqual(r.tags, ["AI / DeepTech", "Seed", "Banjara Hills"]);
  assert.equal(fundedRecentlyEnough(r), true); // directory entries are added without a recent round
  assert.equal(fundedRecentlyEnough({ ...r, allowWithoutFunding: false }), false); // news/YC rules unchanged
  assert.equal(mapToStartup({ ...base, website: "javascript:alert(1)" }, now).website, null); // only http(s) links
  // Openings are trusted only when the dataset checked the board within the job-age window (no stale jobs).
  const hiring = (checkedAt: string) => ({ ...base, hiring: { active: true, count: 1, checkedAt, roles: [{ title: "Backend Engineer", url: "https://boards.greenhouse.io/x/jobs/1" }, { title: "", url: "https://x.io" }] } });
  assert.equal(freshRoles(hiring("2026-10-27T00:00:00Z"), now).length, 1);
  assert.equal(freshRoles(hiring("2026-08-22T00:00:00Z"), now).length, 0); // two months old: ignored
  assert.equal(freshRoles({ ...base, hiring: { active: false, checkedAt: "2026-10-27T00:00:00Z", roles: [{ title: "A", url: "https://a.io" }] } }, now).length, 0);
});
t("YC batch dates the funding at Demo Day", () => {
  assert.equal(ycBatchFundingDate("Y Combinator Spring 2026"), "2026-06-01");
  assert.equal(ycBatchFundingDate("Y Combinator Winter 2021"), "2021-03-01");
  assert.equal(ycBatchFundingDate("Seed"), null);
  const now = new Date("2026-10-12");
  assert.equal(fundingStatus(ycBatchFundingDate("Y Combinator Spring 2026"), null, now), "funded_180");
  assert.equal(fundingStatus(ycBatchFundingDate("Y Combinator Winter 2026"), null, now), "older");
});
t("funding buckets", () => {
  const now = new Date("2026-10-01");
  assert.equal(fundingStatus("2026-09-20", "Seed", now), "funded_30");
  assert.equal(fundingStatus("2026-06-01", "Seed", now), "funded_180");
  assert.equal(fundingStatus(null, "Y Combinator Winter 2021", now), "older");
  assert.equal(fundingStatus(null, "Y Combinator Fall 2026", now), "unknown");
  assert.equal(fundingStatus(null, null, now), "unknown");
});
t("new startup threshold", () => {
  assert.equal(isNewStartup(2025), true);
  assert.equal(isNewStartup(2019), false);
  assert.equal(isNewStartup(null), null);
});

console.log("job roles");
t("AI roles", () => {
  assert.ok(roleCategories("AI applied engineer - Voice first (Internship)").includes("AI / ML"));
  assert.ok(roleCategories("Senior Machine Learning Engineer").includes("AI / ML"));
  assert.ok(roleCategories("Software Engineer", "Engineering · Machine learning").includes("AI / ML"));
});
t("full stack roles", () => {
  assert.ok(roleCategories("JS/Web3 Full Stack Engineer").includes("Full Stack"));
  assert.ok(roleCategories("Fullstack Developer").includes("Full Stack"));
});
t("a job can be AI and full stack", () => assert.deepEqual(roleCategories("AI Full-Stack Engineer"), ["AI / ML", "Full Stack"]));
t("'maintain' / 'detail' don't count as AI", () => assert.deepEqual(roleCategories("Retail Operations Associate"), ["Other"]));
t("sales is Other", () => assert.deepEqual(roleCategories("Account Executive"), ["Other"]));

console.log("careers pages");
t("careers link by text", () =>
  assert.equal(careersLink(`<a href="/about">About</a><a href="/company/join">Careers</a>`, "https://acme.ai"), "https://acme.ai/company/join"));
t("careers link by path", () => assert.equal(careersLink(`<a href="https://acme.ai/careers"><span>Work</span></a>`, "https://acme.ai"), "https://acme.ai/careers"));
t("no careers link", () => assert.equal(careersLink(`<a href="/blog">Blog</a>`, "https://acme.ai"), null));
t("JSON-LD JobPosting is read, remote India detected", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Full Stack Engineer",
    url: "/careers/fse",
    datePosted: "2026-09-28",
    employmentType: "FULL_TIME",
    jobLocation: { "@type": "Place", address: { addressLocality: "Pune", addressCountry: "IN" } },
    jobLocationType: "TELECOMMUTE",
    applicantLocationRequirements: { "@type": "Country", name: "India" },
  })}</script>`;
  const [j] = jobPostingsFromJsonLd(html, "https://acme.ai/careers", "company_careers");
  assert.equal(j.title, "Full Stack Engineer");
  assert.equal(j.url, "https://acme.ai/careers/fse");
  assert.equal(j.remote, "yes");
  assert.equal(j.remoteScope, "India");
  assert.ok(j.location?.includes("Pune"));
});
t("page without JobPosting gives no jobs", () => assert.deepEqual(jobPostingsFromJsonLd(`<script type="application/ld+json">{"@type":"Organization"}</script>`, "https://a.ai", "x"), []));

console.log("emails");
t("only the startup's own domain, mailto + plain text, entities decoded", () => {
  const html = `<a href="mailto:careers@acme.ai">Jobs</a> write to hello&#64;acme.ai or ceo@gmail.com, partner@other.com, logo@2x.png, noreply@acme.ai, team@eu.acme.ai`;
  const got = extractEmails(html, "acme.ai", "https://acme.ai").map((e) => `${e.email}:${e.type}`);
  assert.deepEqual(got, ["careers@acme.ai:careers", "hello@acme.ai:general", "team@eu.acme.ai:general"]);
});
t("escaped characters in inline JSON don't leak into emails", () => {
  const got = extractEmails(`{"html":"\\u003esupport@routable.com\\u003c/a\\u003e"}`, "routable.com", "https://routable.com").map((e) => e.email);
  assert.deepEqual(got, ["support@routable.com"]);
});
t("first.last addresses are labelled 'person', team inboxes 'general'", () => {
  assert.equal(classifyEmail("priya.sharma@acme.ai"), "person");
  assert.equal(classifyEmail("compliance@acme.ai"), "general");
});
t("contact page link", () => assert.equal(contactLink(`<a href="/company/contact-us">Contact us</a>`, "https://acme.ai"), "https://acme.ai/company/contact-us"));

console.log("resume parsing");
t("finds skills, roles, locations and stated experience", () => {
  const r = parseResumeText(
    "Priya Shah, Pune, Maharashtra. Full Stack Developer with 2 years of experience. Built REST APIs in Node.js and Express, frontends in React and Next.js, data in PostgreSQL. Open to remote."
  );
  for (const s of ["Node.js", "Express.js", "React", "Next.js", "PostgreSQL", "REST APIs"]) assert.ok(r.skills.includes(s), s);
  assert.ok(r.roles.includes("Full Stack Developer"));
  assert.deepEqual(r.locations, ["Pune", "Remote"]);
  assert.equal(r.experienceYears, 2);
});
t("doesn't invent Go/TypeScript from short words", () => {
  const r = parseResumeText("I like to go hiking. TS is my initials. Worked on Excel reports.");
  assert.ok(!r.skills.includes("Go") && !r.skills.includes("TypeScript"));
});
t("AI role inferred from LLM skills", () => assert.ok(parseResumeText("Built agents with LangGraph and Groq LLM.").roles.includes("AI Engineer")));

console.log("rate limiting");
t("6th new profile from the same IP within an hour is refused; other IPs aren't affected", () => {
  const req = (ip: string) => new Request("http://x/api/me", { method: "POST", headers: { "x-forwarded-for": `spoofed-by-client, ${ip}` } });
  for (let i = 0; i < 5; i++) assert.equal(rateLimit(req("203.0.113.7"), "createProfile"), null);
  const blocked = rateLimit(req("203.0.113.7"), "createProfile");
  assert.equal(blocked?.status, 429);
  assert.ok(Number(blocked?.headers.get("Retry-After")) > 0);
  assert.equal(rateLimit(req("198.51.100.9"), "createProfile"), null);
});

console.log("queries");
t("queries come from the profile", () => {
  const q = generateQueries(profile, 2026);
  assert.ok(q.includes("Pune startup hiring Backend Developer"));
  assert.ok(q.some((x) => x.startsWith("remote India")));
  assert.ok(!q.some((x) => /SDET/.test(x)));
});

console.log("jobs recency (posted date vs first seen)");
const NOW = new Date("2026-10-28T12:00:00Z");
t("dated within 7 days is 'new' and says where the date came from", () => {
  const r = jobRecency({ posted_date: "2026-10-25", posted_precision: "exact", discovered_at: "2026-10-27T00:00:00Z" }, NOW);
  assert.equal(r.bucket, "new");
  assert.equal(r.date_basis, "exact");
  assert.match(r.label, /^Posted 3 days ago \(date from the source\)/);
});
t("approximate dates are labelled approximate", () => {
  const r = jobRecency({ posted_date: "2026-10-26", posted_precision: "approx", discovered_at: "2026-10-27T00:00:00Z" }, NOW);
  assert.equal(r.date_basis, "approx");
  assert.match(r.label, /approximate/);
});
t("an undated job first seen yesterday is 'newly found', NOT posted recently", () => {
  const r = jobRecency({ posted_date: null, discovered_at: "2026-10-27T12:00:00Z" }, NOW);
  assert.equal(r.bucket, "newly_found");
  assert.equal(r.posted_age_days, null);
  assert.equal(r.date_basis, "none");
  assert.doesNotMatch(r.label, /^Posted/);
  assert.match(r.label, /not provided.*first seen/i);
});
t("an old dated job that Jyntra only just found is NOT new (first seen never overrides the posting date)", () => {
  const r = jobRecency({ posted_date: "2026-09-01", posted_precision: "exact", discovered_at: "2026-10-28T00:00:00Z" }, NOW);
  assert.equal(r.bucket, "older");
  assert.equal(r.first_seen_age_days < 1, true);
});
t("an undated job first seen weeks ago is 'older', and is still findable", () => {
  const r = jobRecency({ posted_date: null, discovered_at: "2026-09-20T00:00:00Z" }, NOW);
  assert.equal(r.bucket, "older");
  assert.equal(inPostedWindow(r, "any"), true);
  assert.equal(inPostedWindow(r, "week"), false);
});
t("posted window filters: default shows new + newly found, 'dated' only new, 'any' shows everything", () => {
  const nw = jobRecency({ posted_date: "2026-10-27", posted_precision: "exact", discovered_at: "2026-10-27" }, NOW);
  const nf = jobRecency({ posted_date: null, discovered_at: "2026-10-27" }, NOW);
  const old = jobRecency({ posted_date: "2026-10-01", posted_precision: "exact", discovered_at: "2026-10-02" }, NOW);
  assert.deepEqual([nw, nf, old].map((r) => inPostedWindow(r, "week")), [true, true, false]);
  assert.deepEqual([nw, nf, old].map((r) => inPostedWindow(r, "confirmed_week")), [true, false, false]);
  assert.deepEqual([nw, nf, old].map((r) => inPostedWindow(r, "any")), [true, true, true]);
});
t("'newest' ranks confirmed posting dates ahead of undated listings", () => {
  const dated = jobRecency({ posted_date: "2026-10-20", posted_precision: "exact", discovered_at: "2026-10-21" }, NOW);
  const undatedToday = jobRecency({ posted_date: null, discovered_at: "2026-10-28T11:00:00Z" }, NOW);
  assert.ok(newestOrder(dated, undatedToday) < 0);
});
t("a listing the source has not re-confirmed for >36h is flagged", () => {
  const stale = jobRecency({ posted_date: null, discovered_at: "2026-10-20", last_checked_at: "2026-10-26T00:00:00Z" }, NOW);
  const fresh = jobRecency({ posted_date: null, discovered_at: "2026-10-20", last_checked_at: "2026-10-28T06:00:00Z" }, NOW);
  assert.equal(stale.recheck_overdue, true);
  assert.equal(fresh.recheck_overdue, false);
});

console.log("hiring evidence");
t("a job from the company's own ATS is 'verified'; an aggregator listing is only 'listed'; no verification is 'unverified'", () => {
  assert.equal(jobEvidence({ verification: "ats_api", source: "company_careers" }).kind, "verified_opening");
  assert.equal(jobEvidence({ verification: "structured_data", source: "company_careers" }).kind, "verified_opening");
  assert.equal(jobEvidence({ verification: "source_api", source: "himalayas" }).kind, "listed_opening");
  assert.equal(jobEvidence({ verification: null, source: "yc" }).kind, "unverified_opening");
});
t("a funded company with no roles is a funding signal and never 'hiring'", () => {
  const e = companyEvidence({ jobs: [], last_funding_date: "2026-10-01", funding_round: "Seed", last_funding_amount: "$2M", careers_url: null, website: null, emails: [], funding_kind: "confirmed" });
  assert.equal(e.signal, "funding_signal");
  assert.match(e.detail, /not evidence of an open role/);
  const planned = companyEvidence({ jobs: [], last_funding_date: null, funding_round: "Seed", last_funding_amount: null, careers_url: null, website: null, emails: [], funding_kind: "planned" });
  assert.match(planned.label, /not confirmed/);
});
t("careers page without a role is 'hiring unverified'; nothing known is 'none'", () => {
  const base = { jobs: [], last_funding_date: null, funding_round: null, last_funding_amount: null, website: null, emails: [], funding_kind: null };
  assert.equal(companyEvidence({ ...base, careers_url: "https://x.com/careers" }).signal, "unverified_hiring");
  assert.equal(companyEvidence({ ...base, careers_url: null }).signal, "none");
});

t("fit reasons come from the matcher; missing information lists every unknown instead of guessing", () => {
  const m: any = { match_score: 70, relevance: "strong", cap_reason: null, role_match: { level: "strong", note: 'Title matches target role "backend"' }, matched_skills: ["Node.js", "Postgres"], missing_skills: ["Go"], location_match: { level: "unknown", label: "Location not listed" }, experience_match: { level: "fits", label: "Fresher / junior friendly" } };
  const f = fitReasons(m);
  assert.ok(f.reasons.some((r) => /Node\.js/.test(r)) && f.reasons.some((r) => /Fresher/.test(r)));
  assert.ok(!f.concerns.some((c) => /Location not listed/.test(c)), "an unknown location is a gap, not a negative");
  const gaps = missingInfo({ recency: { date_basis: "none" } as any, location: null, remote: "unknown", min_experience: null, salary: null, skills: [], apply_url: null, job_url: "https://x", match: m });
  assert.equal(gaps.length, 6);
  assert.ok(gaps[0].startsWith("Posting date"));
});
t("checkedAgo", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  assert.equal(checkedAgo("2026-10-28T11:59:00Z", now), "just now");
  assert.equal(checkedAgo("2026-10-28T09:00:00Z", now), "3 h ago");
  assert.equal(checkedAgo("2026-10-24T12:00:00Z", now), "4 days ago");
  assert.equal(checkedAgo(null, now), "never");
});

console.log("data normalisation / dedupe");
t("canonicalUrl strips tracking, fragments, www, trailing slash", () => {
  assert.equal(canonicalUrl("http://www.Example.com/jobs/1/?utm_source=x&gh_src=y&id=7#apply"), "https://example.com/jobs/1?id=7");
  assert.equal(canonicalUrl("https://example.com/"), "https://example.com");
  assert.equal(canonicalUrl("javascript:alert(1)"), null);
  assert.equal(canonicalUrl(null), null);
});
t("same job from two sources is detected; different location or unknown location is not merged", () => {
  const a = { url: "https://jobs.lever.co/acme/1?lever-source=x", title: "Backend Engineer", location: "Bengaluru" };
  assert.ok(isSameJob(a, { url: "https://jobs.lever.co/acme/1", title: "Other", location: null }), "same canonical url");
  assert.ok(isSameJob(a, { url: "https://remotive.com/9", title: "Backend Engineer (Full-time)", location: "bengaluru" }));
  assert.ok(!isSameJob(a, { url: "https://x.com/2", title: "Backend Engineer", location: "Pune" }));
  assert.ok(!isSameJob(a, { url: "https://x.com/3", title: "Backend Engineer", location: null }), "unknown location is not evidence");
  assert.ok(!isSameJob(a, { url: "https://x.com/4", title: "Frontend Engineer", location: "Bengaluru" }));
});
t("funding stories: duplicate URL or near-identical headline collapse, dated copy preferred", () => {
  const rows = [
    { title: "Acme raises $5M in Series A led by Foo", link: "https://inc42.com/a?utm_source=tw", source: "inc42.com" },
    { title: "Acme secures $5M Series A funding led by Foo", link: "https://yourstory.com/b", source: "yourstory.com", date: "2026-10-01" },
    { title: "Beta raises ₹20 Cr seed round", link: "https://techcrunch.com/c", source: "techcrunch.com" },
    { title: "Totally different", link: "https://inc42.com/a", source: "inc42.com" },
  ];
  const out = dedupeStories(rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].date, "2026-10-01");
  assert.ok(headlineSimilarity("Acme raises $5M", "Beta raises ₹20 Cr") < 0.5);
});

console.log("routing");
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
t("outreach is a real App Router page and no code opens the old modal", () => {
  assert.ok(fs.existsSync("app/outreach/[startupId]/page.tsx"));
  const files = [...sourceFiles("app"), ...sourceFiles("components")];
  assert.ok(!files.some((f) => /OutreachModal/.test(fs.readFileSync(f, "utf8"))), "OutreachModal still referenced");
});
t("every Reach out link targets /outreach/<startup id>", () => {
  for (const f of ["components/StartupCard.tsx", "components/JobCard.tsx", "app/startups/[id]/StartupOutreachAction.tsx"]) {
    assert.match(fs.readFileSync(f, "utf8"), /href=\{`\/outreach\/\$\{/, f);
  }
});
t("the API the outreach page calls (GET /api/startups/[id]) is implemented", () => {
  assert.match(fs.readFileSync("app/outreach/[startupId]/page.tsx", "utf8"), /api\(`\/api\/startups\/\$\{startupId\}`\)/);
  assert.match(fs.readFileSync("app/api/startups/[id]/route.ts", "utf8"), /export async function GET/);
});
t("nav links point at pages that exist", () => {
  // The primary navigation lives in lib/nav.ts (shared by sidebar, drawer, breadcrumb and command palette); EXTRA is palette-only.
  const src = fs.readFileSync("lib/nav.ts", "utf8");
  const nav = src.slice(src.indexOf("export const NAV"), src.indexOf("export const EXTRA"));
  const hrefs = [...nav.matchAll(/href: "(\/[a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["/dashboard", "/discover", "/career-ai", "/mock-interview", "/open-source", "/news", "/settings"]);
  assert.ok(!hrefs.includes("/applications") && !hrefs.includes("/tools"), "Applications and Tools are not in the navigation");
  for (const href of hrefs) assert.ok(fs.existsSync(`app${href}/page.tsx`), `missing page for ${href}`);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
