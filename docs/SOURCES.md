# Jyntra data sources

Last reviewed: 2026-10-15. **Live status could not be verified from the development sandbox** (outbound network was restricted to package registries), so "Working" below means *the code path is implemented, tested with local fixtures/servers, and handles failure*, not *confirmed against the live provider today*. First real check: run `npm run refresh` on a machine with internet and read the per-source lines (or open `/api/sources/status` after a refresh).

## 1. Inventory (what exists in the code)

| Source (id) | Purpose | Code | Auth | Fields returned | Refresh / cache | Known limits & failure modes | Status |
|---|---|---|---|---|---|---|---|
| **Y Combinator** (`yc`) | Startups that YC lists as hiring, plus their YC job postings | `sources/yc/index.ts` | none | company name, website, batch, regions, team size, description, job title/URL/location/type/salary range/min experience/skills, *relative* posted text ("3 days ago") | directory cached 20 h, company pages 20 h | **Company list comes from a community mirror (`yc-oss.github.io/api/companies/hiring.json`), not an official YC API**: if the mirror stops updating or disappears, this source silently returns stale/no data. Job data is parsed from YC's public company pages (HTML), so a page redesign breaks it. Obeys robots.txt. YC dates are relative, so they are now converted to an *approximate* absolute date at ingestion (marked ≈). No stable job ID is published; the ID in the job URL is used. | Partially official: depends on a third-party mirror and HTML structure |
| **Funding RSS** (`funding_rss`) | Funding announcements (Inc42, YourStory, TechCrunch Startups) | `lib/news/feeds.ts`, `lib/news/refresh.ts`, `sources/funding/index.ts` | none | headline, link, description, publication date | cached 3 h on disk (last good copy is served if the network fails); stored in `funding_articles` | Only headlines that explicitly state a raise are kept (parser is conservative; some real raises are missed rather than guessed). A feed URL change breaks that feed; others continue. Per-feed errors are reported. | Implemented; key-free; primary news source |
| **Greenhouse / Lever / Ashby** (`company_careers`) | Open jobs for a startup's own board | `sources/jobs/ats.ts`, `sources/company/index.ts` | none (public board APIs) | title, URL, location, department/commitment (Lever), description, source id | per startup per discovery run | Greenhouse's public API gives `updated_at` (last edit, **not** the posting date). The old code treated it as the posted date, which made old jobs look new; it is no longer used (date stays unknown unless `first_published` is present). Slugs are inferred from the careers link, so a wrong slug returns nothing. Also reads schema.org JobPosting JSON-LD on careers pages. | Working design; per-company failures are isolated |
| **Himalayas** (`himalayas`) | Remote jobs open to India | `sources/jobs/himalayas.ts` | none | title, company, link, seniority, salary, categories, publication date, description | cached 1 h | Replaces Remotive (its robots.txt now disallows the API). Job links point back to Himalayas. Only jobs open to India/worldwide and posted in the last 7 days are kept. | Implemented |
| **Hyderabad startup dataset** (`startupmaps`) | Directory of ~1,200 Hyderabad startups | `sources/startupmaps/index.ts` | none | name, website, description, address, sector, stage, founded year, careers link; openings only if checked in the last 7 days | file cached 30 min | **Replaces hyderabadstartupsmap.lol, whose robots.txt disallows `/api/startups`.** Reads the MIT dataset `shivtchandra/hydstartuplist` (`data/startups.json`, © Mapping HYD) from raw.githubusercontent.com. Community-maintained: schema or branch changes break it (the run records the source as failed). Its job lists are months old today, so they are ignored. No funding amounts. | Implemented; verified against the live file (1,198 rows) |
| **Open source** (`oss_github`) | Beginner issues in YC open-source companies and popular GitHub projects | `sources/oss/index.ts` | optional `GITHUB_TOKEN` | repo, stars, language, one suggested open unassigned good-first-issue / help-wanted issue | cached 6 h | GitHub search is rate limited (10/min without a token, 30 with). | Implemented |
| **Brave Search** (`search`) | Finds public ATS job-board links from profile-based queries | `sources/search/index.ts` | `SEARCH_API_KEY` | result URL/title → ATS board | per discovery run | Optional; skipped without a key (shown as "not configured", not as a failure). Brave's pricing is per request. | Implemented, optional |
| **Tavily** (`tavily`) | Optional news search to supplement RSS | `lib/news/providers.ts` | `TAVILY_API_KEY` (Bearer) | title, URL, snippet, `published_date` (when given) | one bounded query (10 results) per refresh | Free plan 1,000 credits/month; 1 credit per basic search, so at 4 refreshes/day this uses ~120/month. | Implemented, optional |
| **Google Custom Search** (`google_cse`) | Legacy funding search | `lib/news/providers.ts` | `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` | title, link, snippet, `article:published_time` metatag (often missing) | one query per refresh | **Deprecated: closed to new customers; Google retires the API on 2027-01-01.** Kept only for installs that already have keys. Plan to remove after that date. | Deprecated |

### Data model (PostgreSQL)
* `startups`, `jobs` (+ `external_id`, `canonical_url`, `posted_precision`, `verification`), `funding_articles`, `duplicate_candidates`, `sources` (+ health columns), `applications`, `outreach_messages`, `discovery_runs`.
* Migrations are additive and idempotent in `lib/database/schema.sql` (run on start). Nothing is dropped or rewritten.

## 2. Normalisation (what every source goes through)
`lib/normalize/index.ts`: a value is **stated by the source or `null`**.
* Dates: ISO → exact. Relative text ("3 days ago") → an absolute date counted from the *fetch time*, flagged `approx` (shown as ≈). Anything else → unknown. An approximate date never creeps forward on refresh; an exact date always wins.
* URLs: lower-cased host, `www.` / fragment / trailing slash / tracking params (`utm_*`, `gh_src`, `lever-source`, …) removed **for comparison**; the original apply URL is preserved.
* Employment type canonicalised when recognisable, else kept verbatim. Salary kept only when the source printed one. Skills de-duplicated case-insensitively. Records without a usable title or URL are dropped, not repaired.
* Currency is recorded only when the text contains an unambiguous symbol/code (`$`, `₹`, `Cr`, `€`, `£`, `INR`, …); "5M" alone has none.

## 3. Deduplication rules
Jobs (`lib/discovery/store.ts`), in order: (1) `(source, external_id)`, (2) canonical URL, (3) same normalised title **and the same known location** from *another* source → keep the first copy, log it. Same title with an unknown or different location is **not** merged (unknown ≠ match; a title-only match is logged in `duplicate_candidates` for review). A match updates the existing row, so saved jobs and applications keep working. Each startup's jobs are written in one transaction under an advisory lock; unique indexes backstop it.
Startups: official domain, LinkedIn URL, then normalised name (existing logic); concurrent first-time creation retries on the unique index.
Articles: canonical URL (unique index), then a conservative near-duplicate check (headline similarity ≥ 0.85 and, if both name a company, the same company); anything unsure is kept.

## 4. Provider comparison and decision

| | Coverage | Freshness | Cost | API available | Rate limits | India relevance | Duplication risk | Upkeep |
|---|---|---|---|---|---|---|---|---|
| RSS (Inc42 / YourStory / TechCrunch) | Funding stories from 3 outlets | Hours, dated by publisher | Free | RSS (public) | polite fetching, 3 h cache | High (Inc42, YourStory) | Same raise across outlets, handled | Low; feed URLs occasionally change |
| Tavily | Broad web news, any outlet | Hours–days; `published_date` for news | Free 1,000 credits/month, then paid | Yes, documented | per plan | Query-dependent | Overlaps RSS, handled | Low |
| Google CSE | Broad | n/a | n/a | **Closed to new customers, ends 2027-01-01** | n/a | n/a | n/a | Will need removal |
| Brave Search | Broad (used to find ATS boards) | Daily crawl | Paid per request | Yes | per plan | Query-dependent | Low | Low |
| Wellfound | Startup jobs | n/a | n/a | **No public jobs API found** | n/a | Good | n/a | n/a |
| CutShort | India tech jobs | n/a | n/a | **No official public API found** | n/a | Very good | n/a | n/a |
| LinkedIn | Largest | n/a | n/a | **No public jobs API for this use; scraping is against its terms** | n/a | Very good | n/a | n/a |

**Decisions**
1. **Initial production configuration (small and reliable):** YC + company ATS boards + Himalayas + the three RSS feeds. No API keys needed.
2. **Tavily: optional, off by default.** It is the only keyed search option that is still viable after Google's shutdown and is cheap enough to supplement RSS, but whether it adds *materially* more funding stories than the three feeds could not be measured here (no key, no network). Turn it on, compare `funding_articles` by `provider` for two weeks, and keep it only if it contributes stories the feeds miss.
3. **Google CSE: do not build on it.** Retires 2027-01-01. Legacy support only.
4. **Wellfound / CutShort / LinkedIn: outbound links only** (search links on the Jobs page). No scraping, no scraper-as-a-service, no bypassing of login or bot protection. If you want them as sources, contact each for a partner/feed agreement; the importer would then plug in as one more `StartupSource`.

### Evidence and its limits
* Google CSE closure/sunset: multiple independent 2026 articles (e.g. brave.com/learn/google-api-shutdown, dev.to, cloro.dev) agree on closed-to-new-customers and 2027-01-01. Check Google's own notice before acting on the exact date.
* Tavily: `help.tavily.com` pricing and `docs.tavily.com` credits pages (1,000 free credits/month; basic search = 1 credit). Prices change; re-check.
* Wellfound / CutShort: searches found **no official API documentation**, only third-party scraping services and vendor blogs. That is absence of evidence from search results, not proof; ask the companies directly.

## Himalayas and GDELT switches
`HIMALAYAS_ENABLED=false` disables Himalayas (default on). A failed request never closes postings: partial or failed reads mark results incomplete, and cached good data is served with its real last-success time. `GDELT_ENABLED=true` enables GDELT as a secondary funding-news provider (default off). Neither was verified against the live service in this environment.
