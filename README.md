# Jyntra: current startup jobs, why they fit, and what happened next

**Demo:** _not set. No deployed URL is recorded in this repository; add yours here._ The public `/demo` page is a **fictional sample** (no database, no network calls, made-up companies). It is not a live deployment and shows nothing fetched from a real source.
**Project links:** _add your repository, LinkedIn and contact links here._

## The workflow

1. **Profile.** Create one in a few steps (skills, roles, locations). No account needed; Google sign-in is optional and needs server configuration.
2. **Discover** (`/discover`). One list of individual jobs, with a **Startups** tab for recently funded companies.
   - Each job shows its source, when it was last checked, and the original listing link.
   - Each job says whether it is a *verified opening* (found in the company's own job board or its own JobPosting markup), a *listed opening* (listed by a third party such as the YC directory or Himalayas), or an *unverified listing*.
   - A funding round is shown as a **funding signal**, separate from openings. It is not treated as evidence that anyone is hiring.
   - "Why this fits, and what is missing" lists the matcher's reasons and every unknown (for example "posting date: the source does not give one").
3. **Save, open the original listing, or reach out.** Outreach drafts are always stored first; sending needs an explicit confirmation of the exact previewed text.
4. **Applications** (`/applications`). The single record for a job: status, outreach history, generated answers, reminders and the outcome *you* record. Nothing infers an outcome.

Dashboard: recommended individual jobs, four numbers about your own pipeline, data freshness, next actions. Career tools (`/tools`, secondary): Atlas, mock interview, open source, funding news, Hyderabad directory.

## How dates work

A listing has two different dates and they are never mixed up: the **posting date** the source gave (exact, or approximate when the source only said "3 days ago"), and the date Jyntra **first saw** it. A listing with no posting date is labelled "Posting date not provided. First seen by Jyntra N days ago" and is never called "Posted".

The default view is **New this week**: dated within 7 days, plus listings first found this week whose source gives no date (labelled). **Any date, still listed** shows older roles the source still lists. Dated postings older than 90 days are not stored.

## Email

One draft-and-send service (`/api/comms`). Sending requires: a stored draft, a preview, and a confirmation carrying the preview's content hash; it is claimed atomically, so a retry cannot send twice; it is checked against the signed-in owner; and the result is reported as sent, failed, or *unknown* (check your Sent folder), never assumed. "Accepted by Gmail" does not mean "delivered to their inbox". Messages you send yourself (LinkedIn, a Gmail compose window) can be logged, and are shown as "Logged by you", not "sent". Sending a message never changes an application's status.

## Stack

Next.js 15 (App Router), TypeScript, PostgreSQL, Tailwind v4, shadcn/ui. Sources: YC directory (yc-oss), Himalayas, company career pages (Greenhouse, Lever, Ashby), funding RSS feeds, an open Hyderabad dataset (MIT, © Mapping HYD, https://github.com/shivtchandra/hydstartuplist), GitHub.

## Run it

```bash
cp .env.example .env     # set DATABASE_URL (npm run db:up starts Postgres in Docker)
npm ci
npm run dev
```

Optional: `GROQ_API_KEY` or `GEMINI_API_KEY` (AI drafts, mock interview), `GITHUB_TOKEN`, `CRON_SECRET` (scheduled refresh), `TRUSTED_PROXY_HOPS` (default 1, for one reverse proxy such as Render; set 0 if there is none).

## Checks

| Command | What it covers |
|---|---|
| `npm run lint` | Type check only (`tsc --noEmit`). There is no ESLint configuration. |
| `npm test` | Unit and logic checks. No database or network. |
| `DATABASE_URL=… npm run test:all` | The above plus every database suite (`test:db`, `test:kb-db`, `test:news-db`, `test:account-db`, `test:history-db`, `test:career-db`, `test:workflow-db`). The database scripts print SKIPPED, and still exit 0, when `DATABASE_URL` is unset. They do not read `.env`. |
| `npm run build` | Production build, including type check. |
| `npm run check:sources` | One request per public provider, reachability only. Needs internet. |
| `BASE_URL=… python3 scripts/e2e/regression.py` | Real Chromium, desktop and 390 px mobile, against a running app with seeded data. See `scripts/e2e/README.md`. |

## What has and has not been verified

See `JYNTRA_CHANGES.md` for the latest recorded results. In short: the unit, database, build and browser checks above were run against a local PostgreSQL. **No live provider (YC, ATS boards, Himalayas, funding feeds, Groq/Gemini, Gmail, Google sign-in) has been exercised in these runs**, so source parsing is verified against fixtures only. Sending real email through Gmail, and Google Docs import (public "anyone with the link" documents only), have not been verified against the real services.

## Scheduled refresh

Nothing runs on a timer until you configure it: see `docs/SCHEDULING.md`. The GitHub Actions workflow refreshes every 6 hours and then fails the run if any source is failing, stale or has never run.

## Docs

`docs/SOURCES.md` · `docs/SECURITY.md` · `docs/SCHEDULING.md` · `docs/INTERVIEW_OSS.md` · `JYNTRA_CHANGES.md`

## Licence

MIT. The Hyderabad directory data is © Mapping HYD (MIT).
