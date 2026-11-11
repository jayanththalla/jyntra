# Sign in with Google

Jyntra still works with no account (a session cookie plus an optional private link). Sign in with Google is an addition: it lets a user get the same data back on any device.

## Flow
`GET /api/auth/google/start` -> Google (`openid email profile`, authorization code + PKCE S256 + `state` + `nonce`) -> `GET /api/auth/google/callback`.

* A signed, httpOnly, 10-minute cookie (`jy_login`) holds state, PKCE verifier, nonce and the post-login path. It is HMAC-signed with a key derived from `CREDENTIAL_ENCRYPTION_KEY`, so it cannot be forged.
* The callback checks `state` in constant time, exchanges the code (client secret stays on the server), then verifies the ID token claims: issuer, audience = our client id, expiry, nonce, `email_verified === true`.
* The post-login redirect is a same-site relative path only (`safeNext`), so it cannot be used as an open redirect.
* A **new** session is created and any previous session is deleted (no session fixation).
* Login never receives Gmail access. The separate "Connect Gmail" flow asks for `gmail.send`.

## Account rules (`lib/auth/accounts.ts`)
1. Google account already linked -> that user.
2. Someone is already using the app in this browser with no Google link -> Google is linked to them, so nothing they saved is lost.
3. Otherwise a new user is created and sent to onboarding.
Accounts are never merged by email address alone.

## Setup
1. Google Cloud -> OAuth client (Web application), the same one used for Gmail sending is fine.
2. Authorized redirect URI: `<APP_URL>/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, and `APP_URL` (production).
4. If any is missing, `/login` says Google sign-in isn't configured and the app keeps working without accounts.

## Not included
No unlink / account deletion flow yet, no Microsoft login, no email+password.
