# Scheduled refresh

**Nothing is scheduled until you set up one of the options below.** The app exposes secured entry points; it does not run timers of its own. After setup the workflow's last step calls `POST /api/cron/refresh?scope=health` (needs the same secret) and fails the run with HTTP 503 if any enabled source is failing, stale (36 h) or has never run. Note: the very first run reports `never_run` until a refresh has completed once. You can also confirm manually: `/api/sources/status` (signed in) shows each source's last success, and the dashboard warns when data is older than 36 hours.

## What gets refreshed
| Scope | What | Duration | How it runs |
|---|---|---|---|
| `news` | funding articles from RSS (+ Tavily/Google if keys exist) | seconds | inline; returns a per-provider report |
| `discovery` | startups + jobs from YC, ATS boards, Himalayas, Brave | minutes | background; the endpoint returns `202` immediately |
| `all` | both | | news inline, discovery in background |

Safety: PostgreSQL advisory locks prevent overlapping runs across processes/instances; each source has an 8-minute budget; HTTP retries use exponential backoff (1 s, 3 s) and honour `Retry-After`; stale cached feed data is served if a feed is down; a failing source never stops the others. Reading pages never calls an external API: news is stale-while-revalidate (an older-than-3-hours read starts a background refresh, at most one per 10 minutes per process).

## Required
Set `CRON_SECRET` (16+ characters) on the server. **If it is unset the refresh endpoints answer 503 and do nothing.** Never put it in client code.

## Option A: GitHub Actions (free)
`.github/workflows/refresh.yml` runs every 6 hours. Add repository secrets `APP_URL` and `CRON_SECRET`. GitHub cron is best-effort and pauses after 60 days without repository activity.

## Option B: Render Cron Job (paid service type)
Uncomment the `jyntra-refresh` block in `render.yaml` and give it `DATABASE_URL`. It runs `npm run refresh` inside Render (no HTTP).

## Option C: any scheduler that can run a command or call a URL
```
npm run refresh                # news then discovery (needs DATABASE_URL)
npm run refresh -- news
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/refresh?scope=news"
```
Response codes: `200`/`202` ok · `401` wrong secret · `400` bad scope · `405` GET (never triggers work) · `429` rate limited · `503` secret not configured.

## Operators
The same secret lets an operator trigger a refresh by hand with the `curl` command above. Signed-in users can still start discovery from the app (existing 3-hour cool-down).

## Voice recordings
Expired voice recordings are purged automatically whenever anyone opens the voice session list (`purgeExpiredRecordings()`), and expired recordings are never shown or served in the meantime. No separate job is required.
