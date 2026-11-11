# Workflow refactor: what changed and what was verified

Results below are from one session on a sandbox with local PostgreSQL 16 and Chromium. **No live provider was reachable** (all eight probes failed DNS), so source parsing is verified against fixtures only.

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| ESLint | not configured; not run |
| `npm test` (11 suites) | all passed: 92, 8, 50, 39, 30, 11, 28, 11, 14, 6, 10 |
| Database suites | `test:db` 55, `test:kb-db` 21, `test:news-db` 5, `test:account-db` 5, `test:history-db` 15, `test:career-db` 19, `test:workflow-db` 7; all exit 0 |
| `npm run build` | compiled successfully |
| Browser regression (`scripts/e2e/regression.py`) | 30/30 on one run; 29/30 on two others (one intermittent React hydration error #418 on `/dashboard`, not reproduced in 8 reloads; one run hit HTTP 429 from the per-IP limit caused by back-to-back runs) |
| `npm run check:sources` | 0/8 reachable from the sandbox (DNS). Not a statement about the providers |

## Not verified
Real Gmail sending and OAuth, Google sign-in, Groq/Gemini, every live source, Google Docs import, the Render/GitHub scheduler, mobile on a real device, Safari/Firefox. HTTP-level cross-user tests (ownership is tested at the service level). The Mock interview, Open source and Funding news pages in a browser.

## Changes
- Posting date vs first-seen date are separate (`lib/jobs/age.ts`); default "New this week"; older still-listed roles findable; dated postings over 90 days not stored.
- Evidence model: verified / listed / unverified opening, funding signal, unverified hiring (`lib/jobs/evidence.ts`).
- Navigation: Dashboard, Discover, Applications, Profile & settings; Career tools secondary. `/jobs`, `/yc-jobs`, `/startups` and the Atlas tracker/reminders/answers pages redirect.
- Dashboard rewritten (`/api/dashboard`). Applications is the single record, with user-recorded outcomes (new columns `outcome`, `outcome_note`, `outcome_at`).
- One draft/send service (`lib/comms`): added "logged by you" and application linking; the legacy send route and service were removed (`outreach_messages` kept, read-only). Sending no longer sets "Applied".
- Fixes found by testing: DB pool had no error handler; CSP blocked Radix Select/scroll-lock styles (nonce now passed); onboarding landed on Startups instead of Jobs; empty Jobs state lacked "look anywhere".
- Hardening: real zip-bomb guard for DOCX, PDF page caps, trustworthy client IP (`TRUSTED_PROXY_HOPS`), per-account limits, bounded rate-limit memory, `scope=health` cron gate.
- Copy: Google Docs landing claim removed, illustrative numbers labelled, demo labelled fictional, README rewritten.

## Known remaining
Render cron still commented out (paid). No demo URL or project links exist in the repo. In a deployment without a proxy header every client shares one rate-limit bucket. The 17 removed legacy-outreach tests are covered by `test-career-db` and `test-workflow-db` only for the new service.

---

# Jyntra redesign — what changed

## Build fix
`components/FundingNews.tsx` was imported but missing, so `tsc` and `next build` failed. It now exists.

## Pages
- `/dashboard` overview (AnalyticsDashboard) · `/startups` full directory · `/jobs` · `/applications` · `/news` · `/settings` (My Profile)
- `/outreach/[startupId]` is the only outreach editor. `OutreachModal` was deleted; startup cards, job cards and the startup detail page link to it (`?jobId=` when a job is known).

## Design tokens
`app/globals.css` holds every colour (Jyntra palette, dark default, light mode kept). Use `bg-card`, `border-border`, `text-muted-foreground`, `bg-brand-gradient`, `text-brand-violet`. No green accents remain.

## Jobs
Search (title/company/skill/location), remote/on-site, employment type, source, experience, role, sort (best match / newest), 10/20/30 pagination, mobile filter toggle, "Why this match?", stale / unverified-date indicators (`lib/jobs/age.ts → jobFreshness`).

## Analytics (`lib/analytics/index.ts`, `GET /api/analytics`)
All values come from PostgreSQL; definitions are documented at the top of that file. Nothing is hard-coded or estimated.

## Tests
`npm test` → 63 checks (adds job freshness and routing guards).

## Added in the second pass
- **Outreach bug (root cause):** `/outreach/[startupId]` loads its startup from `GET /api/startups/[id]`, but that route only had `PATCH`, so every Reach Out page answered 405 and showed "Startup not found". `GET` now exists (200 / 400 invalid id / 401 no profile / 404 unknown id).
- **Outreach page:** new "Open in Gmail" compose link (nothing is sent or claimed as sent); copy failures now show a message.
- **Credentials:** `/api/me` no longer returns the Gmail app password; it returns `gmail_app_password_set`. Blank password on save keeps the stored one; clearing the Gmail address clears both. Re-saving the profile via POST no longer wipes saved Gmail credentials.
- **Data quality:** `lib/url.ts` (canonical URLs), `lib/jobs/dedupe.ts` (same role from two sources: same canonical URL, or same title + same known location), `lib/news/dedupe.ts` (same URL or near-identical headline), posted_date is now kept once known. Verified against a real PostgreSQL.
- **News route:** 15-minute cache, 8s timeouts, de-duplication, `fetched_at`, last-good-result fallback marked stale, and a fabricated fallback link removed.
- **Analytics:** SQL verified on PostgreSQL 16; fixed a bug where drafts hid due follow-ups.
- **Jobs page:** links out to LinkedIn / Wellfound / CutShort search (no scraping, no import).
- **UI:** "first steps" checklist moved from Startups to Dashboard; theme control is now a single cycling button (Light, Dark, System) instead of a Radix dropdown.

## Verification actually run
`npx tsc --noEmit` clean · `npm test` 67 passed · `npm run build` passes · headless Chromium against a production build with seeded PostgreSQL: 6 pages x 4 widths (375 / 768 / 1280 / 1920) = 24/24 with no horizontal overflow and no console errors; Reach Out from startup and job cards, missing-startup state, all sidebar links, jobs search/remote/on-site/type/sort filters and the mobile filter drawer all work.

## Third pass: data quality, news, scheduling, outreach, security

### Data and sources (`docs/SOURCES.md`)
* **Normalisation** (`lib/normalize`): dates, URLs, employment type, salary, skills, currency. Relative dates ("3 days ago") are converted to an *approximate* absolute date at ingestion (shown ≈); previously they were stored as text and drifted. Greenhouse `updated_at` is no longer treated as the posting date.
* **Deduplication** (`lib/discovery/store.ts`): by source id, then canonical URL, then same title + same *known* location across sources; unknown location is never a match. Updates keep the same row, so saved jobs and applications survive. Ambiguous cases go to `duplicate_candidates`. Per-startup advisory lock + transaction; concurrent first-time creation retries. Verified with an 8-way concurrent import.
* **Funding news**: stored in `funding_articles` (publisher, original URL, publisher date or NULL, first-ingested, last-checked, freshness, company/amount/round/currency only from the headline). `/api/news` replaces the live-search route; empty/unavailable states show a clearly labelled directory, never static links as news.
* **Refresh**: advisory locks, 8-minute per-source budget, retries with backoff and `Retry-After`, per-source health in `sources`, stale-while-revalidate for news, `POST /api/cron/refresh` (secret, constant-time, closed if unset), `npm run refresh`, GitHub Actions workflow, optional Render cron. **Nothing is scheduled until you configure one** (`docs/SCHEDULING.md`). Dashboard/news pages show a warning when a source is failing or stale.
* **Provider findings**: Google Custom Search closes 2027-01-01 (deprecated); Tavily kept as optional; Wellfound/CutShort/LinkedIn have no public API found: outbound links only.

### Outreach (bugs found and fixed)
* Both hard-coded AI models were **retired** (Gemini 2.0 Flash 2026-06-01; Groq llama-3.1-8b-instant 2026-08-16). Models are now configurable with current defaults; Groq falls back to Gemini.
* `/api/ai/generate-outreach` had **no authentication or rate limit**, trusted client-supplied company/profile data, leaked upstream errors and had no timeout. Now: signed-in only, rate limited, facts loaded from the database, safe typed errors, timeouts. The page no longer swallows failures (success / error + retry / not-configured states).
* **LinkedIn "Copy & open" recorded the message as sent and moved the application to Applied immediately.** Now copy/open records nothing; "I sent it, log it" records a manual log (`delivery='manual'`). Email: arm-then-confirm, recorded only if Gmail accepted it; if recording fails after a successful send the user is told it WAS sent.
* Sending **no longer resets Interview/Offer/Rejected to Applied**. Drafts now exist (save / restore / discard); they were never creatable before, so the "drafts" metric was always 0. The tracker no longer shows a draft as "what you sent".
* Send route validation (ids, recipient, CR/LF, lengths), HTML escaping in emails, display-name sanitising, SMTP timeouts, safe error messages, stricter send rate limit.

### Startup pages
* Detail page: Save / Unsave (only a plain "Saved" entry can be removed; tracked ones link to the tracker), Funding stories card (stored, sourced articles linked to the company), last-checked date in the header.
* Jobs page: fixed layout shift; tap targets; filters unchanged.

### Analytics
* Single read-only snapshot transaction, explicit date coverage (`funding_dated_total` / `funding_undated_total`), `outreach_logged_manually`, controlled errors. The follow-up rule was reviewed against the real workflow (`applied_at` is set to today when status becomes Applied; outreach counts only if SENT) and kept.

### Security (`docs/SECURITY.md`)
`safeHttpUrl` everywhere external links enter; no raw error messages returned; security headers; `.gitignore` fixed (the `.env.example` template was being ignored); every route audited for auth/rate limit.

## Verification actually run on the final code
* `npx tsc --noEmit`: clean. `npm test`: 67 + 49 = **116 passed**. `npm run test:db` against PostgreSQL 16: **69 passed**. `npm run build`: succeeds.
* Headless Chromium against a production build with seeded PostgreSQL, 8 pages x 6 widths (360, 390, 768, 1024, 1440, 1920): see the final report for the exact numbers.
* Browser workflow test (never confirms a send): Reach Out from cards and detail page, AI-not-configured state, save/restore draft, email arm-then-confirm, Gmail compose link, bad `jobId`/startup id, Save/Unsave; the database was checked afterwards (1 draft, 0 sent messages, no application changes).

## Not verified / known limitations
* **No live provider was reachable from the sandbox**: RSS feeds, YC, ATS boards, Remotive, Tavily, Groq and Gemini were exercised only with local fakes. Run `npm run refresh` and an AI draft on a connected machine.
* The AI model defaults (`openai/gpt-oss-20b`, `gemini-3.5-flash`) come from provider documentation found via search, not a live call. If a default is rejected, the page shows "model no longer available"; set `GROQ_MODEL` / `GEMINI_MODEL`.
* An intermittent React hydration warning (#418) seen earlier during development did **not** reproduce on clean builds (0 of 90 loads at 390px; no console errors in the final sweep). Its cause was never identified; stale `.next` output and lingering server processes during testing are the likely explanation, not proven.
* No Content-Security-Policy; Gmail app passwords are plain text in the database; rate limits are per-process (see `docs/SECURITY.md`).
* Several files were edited by someone else between sessions (no git history was available to diff); their changes were kept and verified by measurement rather than reverted.
* Tavily's added value over the three RSS feeds is unmeasured; Google CSE support should be removed after 2027-01-01.

## Fourth pass: merged the newer upstream commits (startup-finder, Oct 14-19)
Jyntra was forked from upstream as of Oct 12. Ported, adapted to the sidebar UI, Postgres layer and security work already here:
- **Funding overhaul:** every report kept (`funding_reports`), stage / confirmed-planned-rumoured kind, INR/EUR/GBP to USD via Frankfurter, second-outlet verification and conflict flags, new India/US feeds (ET, Entrackr, Crunchbase News, TechCrunch Fundraising), VC-fund headlines rejected.
- **HQ country** (India / US) with confidence and evidence, other offices, YC founders, company GitHub. Filters: country, stage, amount, confirmed only, industry categories, work arrangement, internship role type.
- **Recency windows:** startups funded in the last 90 days (plus this year's YC batches); jobs posted in the last 7 days (undated jobs age from first seen). Existing saved/applied/pinned startups stay visible.
- **New pages:** YC Jobs (batch + open-source filters), Open Source (beginner issues), About / Privacy / Terms / Contact, footer, favicon. Sidebar and mobile "More" sheet updated.
- **Himalayas replaces Remotive.**
- **Sessions hardened:** session cookie stores only a SHA-256 hash; private link is a separate token created on demand, replaced when regenerated; legacy tokens migrate automatically. Settings page updated.
- Discover cooldown is 10 minutes (was 3 h).
- Tests: 77 + 49 unit, 71 DB checks pass; `next build` passes; smoke-tested pages and APIs against PostgreSQL 16.
- Not verified: live provider calls (YC, GitHub, Himalayas, feeds, Frankfurter) were not reachable from the sandbox. Run `npm run refresh` on a connected machine.
- Not ported on purpose: upstream's own UI redesign (Jyntra has its own).

## Phase 7: Career AI
Knowledge base, connectors, retrieval and `/career-ai` workspace. See docs/CAREER_AI.md for architecture, tested connectors, env vars, limitations. Fixed while testing: document updates failed on an untyped SQL parameter.

## Fifth pass (fixes)
- Refresh: sources now read in parallel (4-minute budget each), funding feeds read concurrently with capped article lookups, GitHub files read 6 at a time; per-source progress in GET /api/discover; auto-refresh when data is older than 12 h; a run where no source could be reached is now recorded as failed, not done.
- Footer removed everywhere; shared PageSkeleton; client request timeout; Open Source page redesigned; Career AI chat redesigned; AI errors clearer (a bad fallback key no longer hides the real cause; too-large prompts retry with less evidence).

## Hardening pass (security first)
- **Gmail app passwords are encrypted at rest.** `lib/secrets/vault.ts` (AES-256-GCM, HKDF subkey, owner-bound AAD) + `lib/secrets/gmail.ts` (save / keep / clear / use). Key: `CREDENTIAL_ENCRYPTION_KEY` (falls back to `KB_ENCRYPTION_KEY`). No key → saving is refused, never stored in clear. Legacy plaintext is never used for sending and is dropped on next save. Migration: `npm run migrate:gmail` (encrypt) or `-- --purge` (users re-enter).
- **Removed a server-wide mailbox fallback** in `lib/outreach/sender.ts` (`GMAIL_USER` / `GMAIL_APP_PASSWORD` env vars): any signed-in user could previously have sent mail as the operator if their own credentials were missing.
- **Content-Security-Policy** (nonce-based) via `middleware.ts` + `lib/csp.ts`; `CSP_MODE=enforce|report-only|off`; `/api/csp-report`. `app/layout.tsx` now reads the nonce, so pages render per request. Also added `Cross-Origin-Opener-Policy` and `X-DNS-Prefetch-Control`. Site password comparison in middleware is no longer short-circuiting.
- **Release guard:** `npm run check:release` fails on env files, `.neon`, or secret-shaped values.
- **Tests:** new `scripts/test-secrets.ts` (11 checks, part of `npm test`); `scripts/test-db.ts` outreach fixtures now use encrypted credentials, plus a test that legacy plaintext / tampered / another user's ciphertext are never sent.
- **Not done in this pass:** Google Drive connector, scheduled-refresh deployment, provider-by-provider live verification, responsive browser audit. See `docs/AUDIT.md`.

## Career AI fixes (project questions, Groq errors, side panel)
- **"what are projects" / "other projects" answered "not enough evidence"** although 48 documents were indexed: "project(s)" is a search stop-word, so the keyword query was empty. New *portfolio overview* path (`projectOverviewIntent`, `projectOverview` in `lib/kb/search.ts`): one representative document per project across the whole knowledge base (+ resume/profile/notes), optional provider filter ("from github"), and "other/more projects" excludes projects already cited earlier in the conversation. Specific/"how did I build X" questions still use targeted retrieval.
- **Groq "key rejected"**: keys are cleaned (quotes, spaces, newline, `Bearer ` prefix); a 403 `model_permission_blocked_project` is now reported as a model problem (not a bad key) and Groq retries `llama-3.3-70b-versatile`; the error names the provider and env var (`Groq rejected the server's API key (HTTP 401)…`), and the server log says which provider failed and why (no key material).
- **Side panel**: Sources/Chats/Notes tabs are pinned; only the list scrolls, and scroll no longer chains into the page.
- Tests: `test-kb.ts` 19 → 27, `test-kb-db.ts` 18 → 19.

## Phase 9: Career GPT
Application answers, saved facts, conversation memory/rename/search, action suggestions, Gmail OAuth sending with confirm-before-send, bounded chat layout. See docs/CAREER_GPT.md. Also fixed: on 640-1023px screens the expanded sidebar (240px) covered the page because main only had 68px padding. Verified: tsc clean; npm test 77+49+27+29+11+28; test:db 72; test:kb-db 19; test:career-db 19; build OK; Chromium 62/62 at 375/768/1280.

## Real-time pass (2026-10-28)
- **Why data looked 2-3 days old:** a refresh only started when someone *clicked* or after 12 h (jobs) / 3 h (news), and pages loaded their data once and never looked again. Opening a tab left open overnight showed yesterday's jobs.
- **Now:** `GET /api/live` is a cheap heartbeat every app page polls (5 s while a refresh runs, 30 s otherwise, paused while the tab is hidden, immediate on focus/reconnect). It starts a background refresh when jobs/startups are older than 30 min or news is older than 15 min (`config/settings.ts → live`), and returns a `version` that changes when a refresh finishes. Jobs, YC Jobs, Startups, Dashboard, Funding News and Open Source reload themselves on that change (`components/live.ts → useLive`). Overlap is prevented by the existing database advisory lock.
- **Freshness line** (`components/DataFreshness.tsx`) is now a live indicator on those pages: "Live · jobs & startups 4 min ago · news 2 min ago", "Updating … now", or "Offline", plus a warning when a source is failing.
- **Fresher caches:** job boards 1 h → 12 min, RSS 15 → 6 min, YC 20 h → 6 h, shared read cache 10 min → 1 min, manual refresh cooldown 10 → 5 min. Jobs older than 7 days are still dropped (unchanged).
- **Hyderabad startup map:** `hyderabadstartupsmap.lol/api/startups` is disallowed by its robots.txt, which this app honours, so that source could never run. It now reads the open **MIT** dataset `shivtchandra/hydstartuplist` (`data/startups.json`, about 1,200 startups, © Mapping HYD) from `raw.githubusercontent.com` (no robots.txt there), cached 30 min. The dataset's own job lists are used only if they were checked in the last 7 days (today's are months old, so none are shown).
- **Mock interview** (`/mock-interview`, `POST /api/interview`): AI interviewer using the app's existing Groq/Gemini layer. Questions come from your profile (and an optional startup), each answer is scored 1-10 with strengths, improvements, a structure to follow and a follow-up; optional voice via the browser's speech APIs. Recent MIT interview projects are listed on the page and in `docs/INTERVIEW_OSS.md`; no third-party code was copied.
- **Tests:** `npm test` adds `scripts/test-interview.ts` and updated dataset-mapping checks.
- **Hyderabad Map page** (`/hyderabad`, `GET /api/hyderabad`): the app only lists startups funded in the last 90 days, so the ~1,200 directory startups were stored but invisible. This page is a searchable directory (name / description / area, industry filter, "Hiring now", website + careers links, link to the details page) fed from the same database and live-updating like the rest. Attribution to Mapping HYD (MIT) is shown on the page.

## Cleanup and voice interview (2026-10-30)
- Removed application-history import (page, API, tests); `/applications/import` redirects to `/applications`. Import tables are kept for existing data.
- Layered connectivity: "Offline" now means only that the browser is offline. API health, refresh state and per-source health are separate; one leader tab polls; reconnect is debounced.
- Himalayas: validated responses, no cache poisoning, partial reads never close postings, `HIMALAYAS_ENABLED` switch, categorised errors with retry time, secrets redacted.
- Funding news: dedupe by URL and content fingerprint, provenance fields, optional GDELT (`GDELT_ENABLED`), verified company links only, compact cards, neutral empty state.
- Atlas: stale-index detection with queued refresh, per-source sync times on citations.
- Voice interview under Career Tools (`docs/VOICE_INTERVIEW.md`); mock-interview page no longer lists third-party repositories.
- New tests: test-live, test-providers, test-funding, test-voice, test-atlas-db, test-voice-db.
- Funding news: validated "Suggest stories for my profile" (AI ranks only retrieved stories; keyword fallback).
- About page no longer lists open-source discovery among the data sources.
- Full browser regression (30 checks) run on a seeded database: all passed.

## Round 3 (2026-10-31)
- Mock interview: answers that do not address the question (empty, random text, repeated words, or judged off-topic by the model) now score 0; the score range is 0-10.
- Mock interview mic: shows the real reason when the browser speech service cannot record; asks for the microphone first.
- Sidebar: Dashboard, Discover, Profile and the five tools (Atlas, Mock interview, Open source, Funding news, Hyderabad directory). The Tools page is removed (`/tools` redirects to Atlas); mobile bar has Home, Discover, Atlas, Interview, Profile and More.
- Applications page is hidden: no links, `/applications` redirects to the dashboard. Saved data is kept in the database. Dashboard tiles for tracker counts were removed.
- `npm run dev` now uses Turbopack (much faster first compile of each page). `ATLAS_AUTO_REFRESH=false` disables Atlas' automatic stale-index check.
- BLR Startup Arena adapter (optional, `BLRARENA_ENABLED=true`), written against the real `/api/companies/<slug>/jobs` response (JSON array). `/api/companies` does not exist, so slugs come from `scripts/collect-blrarena-slugs.ts` (data/blrarena-slugs.txt) or `BLRARENA_COMPANY_SLUGS`.
- `npm run blrarena:jobs` downloads every listed company's jobs to data/blrarena-jobs.json/.csv (746 slugs included in data/blrarena-slugs.txt).

## Companies directory, analytics dashboard, flat sidebar
- `lib/arena/` reads `data/blrarena-jobs.json` (from `npm run blrarena:jobs`) with no database. Company names use the casing from the job summary when it matches the slug (PwC, AECOM, PhonePe). A posted date in the future (one row had 2027-08-27) is treated as "not listed".
- `/companies` lists every company; `/companies/[slug]` lists that company's own roles with filters (role family, work mode, experience, fresher friendly) and pagination.
- `/dashboard` now shows market analytics from the scrape (open roles, postings by week, work mode, role families, experience asked, top and fastest-hiring companies, newest and fresher roles) above a "For you" section (your matches and next actions from the database).
- Sidebar: one flat list. The "Navigation" and "Career tools" labels are gone and every row uses the same height, padding and gap.
- To refresh the data, run `npm run blrarena:jobs` and restart the server (the file is re-read when it changes).

## Funding news: verification, city, sector, AI analysis
- **Verification status** on every story, derived from fields the app already had: *Verified* = a completed raise carried by 2+ different publishers (`announcement_kind` + `also_reported`); *Single source* = completed, one publisher; *Unconfirmed* = talks, plans or "reportedly". "Verified" means corroborated by more than one outlet, not checked against filings. Filter: `verification=verified|single_source|unconfirmed`.
- **City and sector** (`city`, `sector` on `funding_articles`, taxonomy in `lib/news/taxonomy.ts`). City comes only from text that ties it to the company (a `-based` hint, or "based/headquartered in" in a sentence naming the company) or the matched company record; a city that belongs to an investor or an event is not used, and unknown stays unknown. Sector comes from keyword rules (investor names after "led by/backed by" are ignored); a model is asked only about stories the rules could not place and may only answer with an id from the fixed list.
- **Enrichment runs at the end of every news refresh** (`lib/news/enrich.ts`, called from `refreshNews`). Idempotent; bump `ENRICH_VERSION` to re-run rules (AI-assigned sectors are kept). A failure never fails the refresh.
- **AI analysis panel**: `POST /api/news/analyze {id}`. The model sees only the stored facts for that story; its reply must be plain text with no links, no number that is not in the facts and no claim that the company is hiring, or it is discarded. Cached per story and per exact facts (`funding_article_analysis`). Without `GROQ_API_KEY`/`GEMINI_API_KEY` the panel says so and still shows the facts. The UI keeps "What the story says" (no model) and "AI analysis" (dashed, labelled AI-generated) visibly apart.
- **UI**: verification segmented control, city and sector filters with counts ("City not stated" included), removable active-filter chips, a colour edge and badge per verification state, clickable city and sector tags, breakdown panel per card.
- **Fixed**: investor extraction ran from a headline's "led by X" into the summary's first sentence when the headline had no full stop.
- **Tests**: `scripts/test-enrich.ts` (new, in `npm test`), plus database checks in `scripts/test-news-db.ts`.

## Open source collections and filters, Atlas workflows
- **Open source** (`lib/oss/filters.ts`, `sources/oss/index.ts`, `/open-source`): new *difficulty* filter (read from the issue's own labels and comment count, basis shown on hover, "Not rated" when there is no evidence), *freshness* filter (issue updated within 7/30/90 days) and *programme collections* GSSoC, MLH, CNCF and Apache. Collection membership is discovered at runtime from GitHub (a programme topic on the repo, or the `apache` organisation) and stored in `oss_projects.collections`; nothing is typed in by hand. It shows that GitHub tags the repo, not that the programme accepts it this year, so each chip links the reader to the official site. Run a refresh to populate.
- **Atlas workflows** (`/career-ai/workflows`, `POST /api/kb/workflows`, `lib/kb/workflows.ts`): *Resume vs job* (skills named in a pasted job description against your Atlas skills, project stacks and profile, with the evidence for each; rule-based), *Learning roadmap* (missing skills ordered by how often the job asks for them, as build tasks tied to your own projects; rule-based, week counts labelled as rough) and *Resume bullets* (an AI rephrase of one project's own facts; any bullet that adds a number, link or technology not in the source is dropped, and a plain template is used when no AI key is set).
- Tests: `scripts/test-oss-filters.ts`, `scripts/test-workflows.ts` (both in `npm test`).


---
## Update: interview v2, realtime voice, written/SQL tests, PDF, funding connectors, verified company links
See docs/INTERVIEW_V2.md and docs/FUNDING_CONNECTORS.md. Migration: `lib/database/interview-v2.sql` (additive, idempotent, applied by `npm run db:migrate`).

## v7: loading system, dashboard, navigation
- Fonts: Bricolage Grotesque (headings, `font-bricolagegrotesque`) + Inter (body, `font-inter`). Plus Jakarta Sans removed from the app.
- One loader: `components/Skeleton.tsx` -> `<Skeleton variant="card-list|news-grid|interview-progress|startup-cards|list|form|table" count={n} />` and `<RefreshShimmer active>`.
  First load = skeleton shaped like the content; later reloads/filters = light shimmer over existing content. "Getting things ready", "Getting your latest matches ready" and bare "Loading…" are gone (LoadingHint/CardSkeleton deleted).
- DataFreshness no longer reserves an empty strip (the white gap under the header); it renders only offline/reconnecting notices.
- Dashboard: AI Interview appears once (hero). Quick cards share one style with 3D art; the overlapping "sheet" is gone.
- Profile has one entry point: the top-bar account menu (removed from sidebar, shortcuts).
- Settings: setup bar, Gmail badge and account line come from saved data.
