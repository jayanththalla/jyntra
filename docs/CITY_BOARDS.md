# City company boards (Hyderabad and others)

How it works, in one line: companies publish their open roles through public job-board feeds (Greenhouse, Lever, Ashby).
Jyntra reads those feeds on a schedule, keeps the roles located in the city, and stores each role with the company's real
application link.

## Add companies
1. Put the company in `data/companies-input.txt` as `Name, https://website` and run
   `npm run boards:discover -- hyderabad`. It looks for a Greenhouse / Lever / Ashby link on the company's own pages
   (robots.txt respected), checks that the feed works and that it has jobs in the city, and adds it to `data/boards.json`.
2. Or edit `data/boards.json` by hand: `{ "name", "ats", "slug", "city", "website" }`. The slug is the part of the careers
   URL after the provider's domain (`boards.greenhouse.io/<slug>`, `jobs.lever.co/<slug>`, `jobs.ashbyhq.com/<slug>`).
3. `npm run boards:probe` calls every entry once and writes `data/boards-report.json` (ok / notfound / error, and how many
   jobs are in the city). Remove or fix the `notfound` ones.

## Keep it fresh
- Scheduler: `.github/workflows/boards.yml` (every 2 hours) calls `POST /api/cron/refresh?scope=boards`.
  Needs the `APP_URL` and `CRON_SECRET` secrets. Any other cron service can call the same URL.
- A role a company closes disappears from its feed, so the next successful sync marks it closed.
- A failed or timed-out request keeps the last good roles and marks the company stale; it never closes roles.
- Not literally real-time: Greenhouse, Lever and Ashby do not push changes to third parties, so freshness is the polling
  interval (2 hours here, 30-minute feed cache).

## Limits
- Only companies using Greenhouse, Lever or Ashby are covered. Workday, SuccessFactors, Zoho and LinkedIn-only
  companies need their own reader (see `sources/jobs/`), or an official partner/feed.
- One city per board entry. A company hiring in two cities needs two entries with different names.
