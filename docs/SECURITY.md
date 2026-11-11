# Security notes

## Secrets
* `.env` is git-ignored (and `.env.*`, except the blank template `.env.example`). **The original upload contained a real `.env`; rotate every key that was in it** (database URL/password, Groq, Gemini, Google, Tavily, Brave, Gmail app passwords, `CRON_SECRET`).
* No code logs environment values. Provider errors are logged as a short code only; upstream response bodies and request URLs are never logged or returned.
* **Gmail app passwords are encrypted at rest** (AES-256-GCM, `lib/secrets/vault.ts`). The key comes from `CREDENTIAL_ENCRYPTION_KEY` (falls back to `KB_ENCRYPTION_KEY`) and lives only in the server environment. A purpose-specific subkey is derived with HKDF, and the owner's user id is bound as authenticated data, so a ciphertext copied to another user's row fails to decrypt. The database holds `gmail_app_password_enc`; the browser only ever sees `gmail_app_password_set` / `gmail_app_password_reenter` flags. A blank password on save keeps the stored one; clearing the Gmail address deletes it. With no key configured, saving a password is refused (it is never stored in the clear) and sending is unavailable. There is **no server-wide mailbox fallback**: only the signed-in user's own credentials are ever used.
* **Migrating existing records:** run `npm run migrate:gmail` (encrypts in place, needs the key; `-- --dry-run` reports counts only) or `npm run migrate:gmail -- --purge` (deletes plaintext; affected users re-enter it in Settings). Until migrated, a legacy plaintext password is **never used for sending**; the user sees "re-enter" and the plaintext is dropped on their next profile save. Rotating the key makes saved passwords undecryptable; users re-enter them.
* **The original upload contained a populated `.env`.** Treat every key that was in it as exposed and rotate it (database credentials, Groq, Gemini, Google, Tavily, Brave, `CRON_SECRET`, and any Gmail app passwords). Run `npm run check:release` before building any archive; it fails if env files or secret-shaped values are present.
* Gemini's key is sent in the `x-goog-api-key` header, not the URL.

## Authentication and authorisation
| Endpoint | Who can call it |
|---|---|
| `POST /api/cron/refresh` | Anyone holding `CRON_SECRET` (constant-time compare). **Closed (503) if the secret is unset or shorter than 16 chars.** `GET` is 405 so crawlers/prefetch can never trigger work. |
| `POST /api/discover` | Signed-in user (3-hour cool-down) or `CRON_SECRET` |
| `POST /api/ai/generate-outreach` | Signed-in users only; 20 calls/hour/IP; 4 KB body limit; facts loaded from the database, never from the request |
| `POST /api/outreach/send` | Signed-in; real emails limited to 15/hour/IP; recipient, subject (no line breaks), body and ids validated; job must belong to the startup |
| `/api/outreach/messages`, `/api/applications*`, `/api/analytics`, `/api/startups*`, `/api/sources/status`, `/api/me*` | Signed-in; every query is scoped to the caller's user id |
| `GET /api/news` | Public (published headlines only); validated parameters; no external call per request |
| `POST /api/resume` | Pre-profile (onboarding): 5 MB limit, `%PDF-` check, rate limited, nothing stored |
| `GET /api/health` | Public; does not touch the database |

Sign-in is a long random token in an HTTP cookie (existing design). There are no passwords or accounts to phish, but **anyone holding the private link/cookie is that user**. This is by design and unchanged.

## Input handling
* All SQL is parameterised. The only string-built SQL fragments are numeric `LIMIT`/`OFFSET` values that are clamped integers.
* External links (sources, scraped pages, profile fields) are reduced to plain `http(s)` URLs by `safeHttpUrl` at ingestion, in the loader that feeds every page, and when saving the profile: `javascript:`, `data:`, `file:`, credentials-in-URL and control characters are rejected.
* Email: recipient/subject with line breaks are refused (header injection), the sender display name is stripped of quotes/brackets/control characters, and the HTML part of an email is escaped.
* Untrusted web text placed in an AI prompt is fenced in a `<company>` block with an instruction to treat it as data; model output must parse as `{subject, body}` and is rejected if it still contains `[placeholders]`. This reduces, but cannot eliminate, prompt injection; the user always reviews the draft.
* Database errors never reach the browser: routes return a short code (`server_error`, `analytics_unavailable`, `news_unavailable`).

## Headers and Content-Security-Policy
`next.config.ts` sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` (6 months), `Cross-Origin-Opener-Policy`, `X-DNS-Prefetch-Control`. `X-Powered-By` is removed.

`middleware.ts` sets a **nonce-based Content-Security-Policy** (`lib/csp.ts`) on every page and API response, so the CSP lives in exactly one place. `script-src 'self' 'nonce-…' 'strict-dynamic'` (plus `'unsafe-eval'` in development only), `style-src 'self' 'nonce-…'` with `style-src-attr 'unsafe-inline'` (attributes only, needed by Radix/React runtime styles), `img-src 'self' data: blob:`, `font-src 'self'` (fonts are bundled), `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `frame-src 'none'`, `upgrade-insecure-requests` in production. Server-side calls to AI/search providers are not subject to CSP and are intentionally not listed. Consequence: pages render per request (the nonce is per request), which the build output shows as dynamic (ƒ).
`CSP_MODE=enforce` (default) | `report-only` (sends `Content-Security-Policy-Report-Only`; violations are logged by `/api/csp-report` as a short sanitised line) | `off`. **Verification status:** headers, per-request nonce, nonce on all 34 script tags of a rendered page, and report-only mode were verified against a production build over HTTP. It has **not** been verified in a real browser (none was available in the build environment). Before relying on enforcement, deploy with `CSP_MODE=report-only`, click through every page and the Career AI flows, check logs for `[csp]` lines, then switch to enforce.

## Known limitations
* CSP is implemented but pending real-browser validation (see above).
* Rate limiting is in-memory per process and keyed by client IP taken from the **first** `X-Forwarded-For` entry, which a client can forge unless the platform proxy overwrites the header. Behind a proxy that appends rather than overwrites, limits can be evaded. Per-user limits and a shared store (database/Redis) are not implemented.
* KB provider tokens (GitHub) use the older `v1` envelope without owner binding (`lib/kb/crypto.ts`); Gmail uses the stronger `v2` vault. Moving them to the vault is a follow-up.
* No CSRF token. The session cookie is `httpOnly`, `SameSite=Lax` and `Secure` in production (verified in `lib/users.ts`), which blocks cross-site POSTs in current browsers; mutating endpoints also require a JSON body.

## Career AI
See [docs/CAREER_AI.md](docs/CAREER_AI.md). Set KB_ENCRYPTION_KEY to enable credential-based connectors. Credentials are AES-256-GCM encrypted, secrets files are never indexed, and every query is scoped to the signed-in user.
