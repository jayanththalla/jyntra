# Browser regression

Needs Python Playwright with Chromium, a running production build, and a database seeded with at least: a company with a dated job
(2 days old, `verification='ats_api'`), an undated job (no `posted_date`), a job dated ~40 days ago that fits the profile
(Node.js/Postgres backend), a company whose `funding_round` is `Y Combinator Winter 2026` with a `source_api` job, and a funding-only
company. The script creates its own user through the real onboarding flow.

    npm run build && DATABASE_URL=… npm start -- -p 3100 &
    BASE_URL=http://localhost:3100 python3 scripts/e2e/regression.py

Run it a few times in a row from one IP and you may see HTTP 429 from the per-IP read limit; wait a minute between runs.
