# Automated job ingestion (Bengaluru, Hyderabad, Chennai, India-remote)

Opening Jyntra never contacts a company site or ATS. A background engine discovers employer boards, fetches their public job feeds on a durable schedule, normalises the jobs and stores them in PostgreSQL. The UI reads only `/api/jobs/feed` (database-backed).

```
registries / website resolution / admin ─▶ discovery_candidates ─(validate + India gate)─▶ job_sources ─▶ worker/scheduler
   ─▶ provider.fetchJobs ─▶ finalizeJob (apply-URL check, city class, hash) ─▶ persistJobs (idempotent) ─▶ company_jobs ─▶ /api/jobs/feed ─▶ Discover › Company boards
```

## What was found in the existing repository (audit)
- Companies = `company_profiles`, jobs = `company_jobs` (kept and extended, not duplicated). Directory pages and `/api/companies/[slug]/jobs` read these tables, so ingested jobs and their apply links appear there automatically.
- Before: the only ingestion was the BLR Startup Arena API plus a Greenhouse/Lever/Ashby reader driven by `data/boards.json`, which was **empty** (zero boards synced). Scheduling was HTTP-triggered (`/api/cron/refresh`) from a best-effort GitHub cron; no worker. ATS responses were cached on local disk (lost on redeploy).
- Apply URLs: the persistence code already used `COALESCE(new, old)` so a null never erased a link. Links were missing when the upstream record carried none. The new path takes the provider's own apply/job URL, validates it (https, no credentials, not a company homepage) and never invents one; regression tests cover repeated syncs.
- Legacy `lib/company-jobs/boards-sync.ts` remains but `scope=boards` now runs the new engine.

## Run it
```bash
npm install
npm run db:migrate                 # idempotent; also applied automatically on first DB use
npm run jobs:discover -- --registry path/or/url/companies.json --origin jobscraper_hourly   # import candidates (no sources yet)
npm run jobs:discover              # validate due candidates (JOB_DISCOVERY_DAILY_LIMIT per day); passing boards become sources
npm run jobs:sync                  # drain due sources once and exit (cron)
npm run jobs:worker                # long-running: polling + daily discovery + graceful shutdown (SIGTERM)
npm run jobs:validate-live -- greenhouse:stripe lever:palantir workday:tenant/wd3/Site   # live check, no DB (run where ATS hosts are reachable)
npm test ; npm run test:ingestion-db ; npm run build
```
Deployment choices (pick one; correctness never depends on cron): **worker** (`render.yaml` block, `npm run jobs:worker`) · **GitHub Actions fallback** (`.github/workflows/ingest.yml`, needs secret `DATABASE_URL`) · **HTTP trigger** `POST /api/cron/refresh?scope=ingest|discover` with `CRON_SECRET` (bounded to 45 s). If nothing runs, the site keeps serving the last good data and each job shows its real "last checked" time and a stale/unavailable label.

## Data model (`lib/database/ingestion.sql`, additive)
`company_profiles`+cols · `company_locations` · `job_sources` (status, interval, failures, etag/last-modified, lease) · `company_jobs`+cols (`source_id`, `content_hash`, `status`, `closed_at`, `locations[]`, `city_class`, `remote_india`, provenance/licence) with `UNIQUE(source_id, external_job_id)` · `ingestion_runs` · `discovery_candidates` · `source_discovery_runs` · `discovery_state` · `company_funding_signals`. Multi-locations are stored in `company_jobs.locations` (no separate `job_locations` table needed).

## Behaviour guarantees (all covered by tests)
- Idempotent upserts keyed on `(source_id, external_job_id)`; unchanged payload ⇒ 0 inserts/updates; `first_seen_at` preserved; reopened jobs restored.
- A job is closed **only** after a successful, complete fetch. 403/429/5xx/timeout/DNS/challenge/invalid JSON/odd structure/page-cap hit never close anything; jobs are flagged stale and the source backs off (exponential + jitter, `Retry-After`, ≥6 h for 429/blocked/challenge; failing after 3, needs_review after 20). An empty "complete" answer from a populated board is withheld as suspicious.
- A missing/invalid apply URL never overwrites a stored valid one and is never replaced by a homepage.
- `posted_at` only from a source-stated publication date (never `updated_at`/now); Workday day-precision dates are not moved after first sight.
- City class comes from each job's own location: Bengaluru, Hyderabad, both (only when both are listed), India remote (needs an India signal; bare "Remote" doesn't qualify), other India, unknown. Hyderabad-Pakistan and "Indianapolis, IN" are excluded.
- Conditional requests (`ETag`/`Last-Modified`), response-size caps, redirect re-validation, https-only/private-IP refusal (SSRF), validated board identifiers, allowlisted adapters only, per-provider/per-host/global concurrency, source leases (`FOR UPDATE SKIP LOCKED`), per-source advisory lock on writes.
- Discovery never guesses a slug from a name. States: candidate discovered → website identified → career page identified → ATS detected → board validated → active source (or failed / needs manual review). A board is activated only if it answered with valid job data **and** has at least one Bengaluru/Hyderabad/India-remote job. robots.txt is respected when resolving careers pages. Darwinbox/Cloudflare challenges are recorded as blocked, not bypassed.

## Admin
`/admin/sources` (enter `JOB_SYNC_SECRET`; the API enforces it, closed when unset): counts, per-source status, validate / retry / pause / reactivate, add company or board, inspect last fetch and run history. No credentials, tokens or response headers are exposed.

## Sources that need permission, credentials or a partnership (not integrated)
- **BLRStartupArena** company dataset, **Mapping HYD** dataset: no bulk access taken; use `jobs:discover -- --leads export.csv --origin directory:<name>` once an export is provided. **T-Hub / Startup Telangana / Lab32** are company-lead sources (names + websites), imported the same way.
- **Jobvetta (50 req/day, 10 results), Startup Jobs, Adzuna**: not integrated (terms/attribution/limits must be reviewed first). If added they must use `license_class='aggregator_restricted'` plus `attribution`, columns already present on every job.
- **OpenStreetMap / Overture office directory and map**: schema (`company_locations`) is ready; the importer and map UI are **not built**.
- **Funding → jobs linking**: `company_funding_signals` exists; no importer wired.
- Oracle, SuccessFactors, iCIMS, Phenom, Eightfold, Teamtailor, Freshteam, PeopleStrong, PyjamaHR, ZappyHire, Zoho Recruit, TurboHire, GreytHR: see `docs/PROVIDERS.md`.

## Rollback / recovery
Everything is additive. To stop: set `JOB_INGESTION_ENABLED=false`, or `UPDATE job_sources SET status='paused'`. To hide ingested jobs without deleting: `UPDATE company_jobs SET is_active=false WHERE source_id IS NOT NULL`. To fully remove (destructive, deliberate): `DROP TABLE company_funding_signals, discovery_state, source_discovery_runs, discovery_candidates, ingestion_runs CASCADE; DELETE FROM company_jobs WHERE source_id IS NOT NULL; DROP TABLE job_sources CASCADE;` — the extra columns on `company_jobs`/`company_profiles` are harmless to leave. A crashed worker needs no action: leases expire (15 min) and the source is claimed again. A source stuck in `needs_review` is re-enabled with "Retry" in the admin page.


---

# Bengaluru / Hyderabad / Chennai data supply chain (added)

We do **not** depend on BLRStartupArena's data. Jyntra discovers real employer career boards from public ATS inventories, validates each
against its real endpoint, and ingests the jobs itself.

```
GitHub ats-scrapers/ats-companies/*.csv ─┐
Common Crawl index (cursor) ─────────────┼─▶ discovery_candidates ─ validate (real endpoint) ─▶ source_validations
registries / admin / leads ──────────────┘                              │ India jobs ≥ 1
                                                                        ▼
                                          job_sources (registered even with 0 jobs in a given city) ─▶ worker (30–60 min)
                                          ─▶ company_jobs (cities[], city_class, apply URL) ─▶ /api/jobs/feed ─▶ Discover / Companies
```

## Commands
| Command | What it does |
|---|---|
| `npm run jobs:discover-seed -- --limit 100 [--provider greenhouse] [--dry-run] [--no-validate] [--offset N] [--concurrency N]` | Enumerate inventories → download/parse/dedupe → import candidates → validate against real endpoints → register India-relevant boards → write `reports/discover-seed-*.json` with counts, status distribution and **HTTP request volume + duration**. `--dry-run` writes nothing to the DB (validation is read-only network). |
| `npm run jobs:sync-cities -- --city bengaluru\|hyderabad\|chennai\|india_remote\|all [--dry-run] [--provider X] [--limit N] [--only-known-city] [--verify-urls N]` | Fetch **every** validated board (no city-specific board needed), classify each job's own location, dedupe on `(source_id, external_job_id)`, upsert, report per city/provider. Failed boards keep their previous jobs. |
| `npm run jobs:report [-- --json]` | The admin report (all numbers from the DB). Also `GET /api/admin/ingestion/report` and the card on `/admin/sources`. |
| `npm run jobs:reclassify [-- --dry-run]` | Recompute city classification of stored jobs from their own locations (no network). Run once after deploying Chennai. |
| `npm run jobs:verify-urls -- --limit 200 [--city chennai]` | Live check of employer apply links; records `apply_url_status`, never edits URLs or closes jobs. |
| `npm run jobs:discover-commoncrawl -- --blocks 5` | One incremental Common Crawl step (cursor in `discovery_state.commoncrawl`). |
| `npm run jobs:check-manifest` | Read-only check of the supplemental dataset manifest. |

Run order for a first load: `db:migrate` → `jobs:reclassify` → `jobs:discover-seed -- --dry-run --limit 100` (look at the report) → `jobs:discover-seed -- --limit 100` → raise `--limit` in bounded batches (or just let the worker drain the queue under `JOB_DISCOVERY_DAILY_LIMIT`) → `jobs:sync-cities -- --dry-run --city chennai` → `jobs:sync-cities` → `jobs:report`.

## Inventory source (`kalil0321/ats-scrapers`, MIT)
`lib/ingestion/discovery/ats-inventory.ts` lists `ats-companies/*.csv` through the GitHub contents API (optional `GITHUB_TOKEN`), falling back to the repo tree page's JSON when the API is rate-limited. Nothing is hardcoded. Measured on 1 Nov 2026: **47 CSV files, 80,390 rows; 29,433 candidates for platforms with an adapter; 196 rows rejected as malformed; 2 duplicates; 50,759 rows on 34 platforms with no adapter** (not imported; counted in the report). Identifiers come from each row's real careers URL (the `slug` column is a fallback); a slug/URL disagreement is counted. Workday tenant/cluster/site, Oracle tenant/pod/site and Eightfold tenant domain are never guessed: rows lacking them are rejected. India-native ATS (Darwinbox, Keka) are validated first. Daily incremental (per-file ETag) and weekly forced re-read run in the worker.

## Validation statuses (`source_validations`)
`valid_with_jobs`, `valid_no_jobs`, `not_found`, `unsupported_provider`, `access_restricted` (403/bot challenge — never bypassed), `temporarily_unavailable` (timeout, DNS, 5xx, 429), `invalid_response`. A timeout is never `not_found`; a host that fails DNS is only treated as gone after 4 failed checks ≥ 6 h apart. A board is **registered as a source when at least one job's own location is in India** (any city or India-remote) — even if it has no job in Bengaluru/Hyderabad/Chennai today. Boards with no India jobs stay `board_validated` and are re-checked every 14 days. A resolvable tenant is not proof of the expected company, which is why activation requires real India job records.

## Cities
`company_jobs.cities` holds every tracked city the job itself lists (`bengaluru`, `hyderabad`, `chennai`); `city_class` is the one-bucket summary (`both` = Bengaluru+Hyderabad only, `multi` = anything else with ≥2). India-remote is separate and never shown as an onsite city job. Neighbourhood names (Gachibowli, OMR, Financial District …), `Madras` and `MAA` only count with India context. The classifier version is part of the content hash, so a rule change re-classifies stored rows on the next successful sync of each board (or immediately with `jobs:reclassify`).

## Providers added
Oracle Recruiting Cloud and Eightfold AI (see `docs/PROVIDERS.md`). Still **not** implemented, with reasons: SuccessFactors (XML feeds that the reference project measured at 30–150 s per tenant, unverifiable here), iCIMS, Phenom, Freshteam, PeopleStrong, PyjamaHR, Zoho Recruit, TurboHire (no verified public endpoint), Taleo, Teamtailor.

## Schedule (worker)
Active boards: `job_sources.poll_interval_minutes` default **60** (±10 % jitter; override per source or `JOB_SYNC_DEFAULT_INTERVAL_MINUTES`). Failed boards: bounded exponential backoff (1 min → 12 h, ≥ 6 h for 429/blocked), `failing` after 3, `needs_review` after 20. Daily: inventory (incremental), Common Crawl blocks, manifest check. Weekly: forced inventory re-read. Every 15 min: validation queue under `JOB_DISCOVERY_DAILY_LIMIT` (default 1500) and `JOB_DISCOVERY_BATCH` (200). The frontend never triggers a fetch.

## Supplemental dataset (`storage.stapply.ai/jobhive/v1/manifest.json`)
Only the manifest is read, daily (`discovery_state.stapply_manifest`: `updated_at`, `ats_count`, company/job totals, per-source rows and URLs where present). **Job rows are not downloaded or stored**: the repository's MIT licence covers its code, no data-use terms for the hosted job data were found, and `SUPPLEMENTAL_INGESTION_ENABLED` is a constant `false` until they are verified in writing. If enabled later it must be per-ATS/city slices, `license_class='aggregator_restricted'`, and deduplicated against direct employer jobs on canonical apply URL.

## Other discovery inputs
- **Common Crawl** (`index.commoncrawl.org`, patterns for Greenhouse, Lever, Ashby, Workday): implemented with a persisted `(crawl, pattern, page)` cursor; Workday `impl*` sandbox tenants and Greenhouse plumbing paths are skipped. The existing Internet Archive CDX source remains (`JOB_DISCOVERY_CDX=true`).
- **open-jobs snapshot** (CC0, last snapshot 5 Oct 2026, crawler stopped 10 Oct): licence verified, **not imported yet**. If imported it is a one-time candidate input only; its jobs are never current vacancies.

## Verification status — read this
Everything below the network layer is covered by automated tests with fixtures (`npm test`, `npm run test:ingestion-db`). The build sandbox could download the GitHub inventories but **could not reach any ATS host** (DNS for `boards-api.greenhouse.io`, `*.myworkdayjobs.com`, … fails there), so **no live board validation or live job fetch has been run**. `jobs:discover-seed -- --dry-run --limit 100` therefore reported 100 × `temporarily_unavailable` plus an explicit network note, not 100 "not found". Run the commands above from a host with normal internet access to produce real board and job counts.
