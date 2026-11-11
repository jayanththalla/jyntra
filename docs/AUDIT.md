# Audit checklist

Status legend: **verified** (exercised by a test or a real run in this pass) · **fixed** · **incomplete** · **not tested** · **blocked** (needs credentials / browser / deployment).
Environment of this pass: Node 22, PostgreSQL 16 (local, throw-away DBs), production `next build`/`next start`. No browser, no live provider credentials, no deployment.

## Phase 1 — Security
| Item | Status | Evidence |
|---|---|---|
| Gmail app password encryption at rest | **fixed + verified** | `scripts/test-secrets.ts` (11), `scripts/test-db.ts` (ciphertext-only in DB; legacy plaintext, tampered and foreign ciphertext never sent) |
| Credential never returned by `/api/me` | **fixed + verified** | `publicProfile()` test; flags only |
| Server-wide mailbox fallback (`GMAIL_*` env) | **found + fixed** | removed from `lib/outreach/sender.ts`; test asserts the sender is not called |
| Migration of existing plaintext | **implemented, not run** against production data | `npm run migrate:gmail [-- --dry-run \| --purge]`; the script was not executed (no real data here) |
| CSP | **implemented; header/nonce verified over HTTP; NOT browser-verified** | production build: header present, 34/34 scripts nonced, report-only mode + `/api/csp-report` work |
| Existing headers | verified, no duplicates | CSP only in middleware |
| KB queries scoped by `user_id` (search, documents, conversations, sources, chunks join) | **verified** (code review + existing `test-kb-db`: B sees nothing of A, guessed ids change nothing, conversation hijack blocked) |
| Applications / outreach scoped by user | **verified by code review**; outreach covered by tests; applications cross-user route test **not added** |
| Refresh endpoint rejects unauthorised | **verified** (`test-db`: 503 unset, 401 missing/wrong, 405 GET) |
| Revoked session | covered at data layer (`sessions: sign-out`); route-level regression test **not added** |
| Rate limiting on AI/KB/ingest | present, **weak**: per-IP, in memory, trusts first `X-Forwarded-For` |
| OAuth state (GitHub) | verified by code review: signed state + cookie + constant-time compare |
| Error messages leak internals | spot-checked routes return short codes; not exhaustively fuzzed |
| Plaintext secrets in the uploaded archive | **found**: `.env` shipped in the zip. **Rotate all keys in it.** `npm run check:release` now blocks this |

## Phase 2 — Google Drive: **not implemented in this pass.**
## Phase 3 — Career AI connectors
| Connector | Status |
|---|---|
| GitHub (OAuth / public username) | unit-tested with a fake fetch (49 + 29 checks) and DB-tested sync/revoke/rate-limit/purge; **not run against live GitHub** (no credentials) |
| Codeforces | unit-tested with fakes; **not run live** |
| LeetCode | **manual import only** (by design; never touches the network) |
| LinkedIn | **pasted text only**, no fetch |
| Uploads (pdf/docx/txt), notes | unit-tested extraction; upload route not browser-tested |
| Portfolio URL | SSRF guards unit-tested |
## Phase 4 — Jobs / funding providers: **not audited provider-by-provider in this pass** (YC, Greenhouse, Lever, Ashby, Himalayas, RSS, Google CSE [deprecated, retires 2027-01-01 per `.env.example`], Tavily). Existing dedupe tests pass.
## Phase 5 — Scheduling: existing `.github/workflows/refresh.yml`, `render.yaml`, `/api/cron/refresh` (locks, auth) unchanged; **nothing was configured or verified in a deployment.**
## Phase 6 — Analytics / outreach workflow: DB suite (72 checks) passes, including analytics scoping and outreach send/draft logic. Entry points, provider failure UI and Gmail compose were **not browser-tested**.
## Phase 7 — Responsive UI: **not done** (no browser available).
## Phase 8 — Release: `tsc` clean · `npm test` 185 checks pass · `test:db` 72 · `test:kb-db` 18 · `next build` passes (run before the final doc/test-only edits).
