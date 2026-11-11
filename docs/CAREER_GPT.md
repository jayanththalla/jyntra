# Atlas (Phase 9)

## Audit before the work (what already existed)
Present and preserved: knowledge base + connectors, hybrid retrieval (structured entities + PostgreSQL full-text; no embeddings), Groq/Gemini providers, conversations/messages/notes, encrypted Gmail App Passwords, outreach tracker, `/career-ai` chat. Phase 8 fixes verified in code: portfolio-overview path for "what are my projects / other projects", Groq key cleaning + `model_permission` handling + fallback model, pinned side-panel tabs.
Missing (now built): application-answer workflow, saved facts, rolling conversation memory, follow-up handling, rename/search of chats, action suggestions, Gmail OAuth/API sending, general email drafts with confirm-before-send, bounded chat layout (page-level scrolling and sticky composer replaced).

## Screens
`/career-ai` chat · `/career-ai/applications` application answers · `/career-ai/email` drafts and sending.

## Application answers
Paste questions (single, numbered, bulleted, with a job description) -> `lib/career/application.ts` parses each question and its own word/character limit (limits under 10 are ignored). Per question: intent -> facts only you can give (salary, notice period, work authorization, relocation) are asked for, never guessed, and no model call is made -> retrieval (resume, balanced projects for broad questions, focused evidence for named projects) -> ONE model call (JSON: answer, used ids, missing, assumptions) -> limit check (one rewrite, then a cut at a sentence boundary with a warning) -> consistency check (numbers and skills not found in any source are flagged) -> evidence from the ids the model reported. Answers contain no `[S1]` markers so they can be pasted. Regenerate / shorten / expand / tone, edit, copy, copy-all, export .md, save to notes, link to an application. Style rules aim at plain, specific, first-person writing; there is no detector-evasion logic.

## Memory
Conversations are per user. The model receives a deterministic rolling summary (no extra model call) plus the last 6 messages, marked "context only, not evidence". Short follow-ups ("make that shorter") reuse the previous answer's cited documents. Facts: `user_confirmed` are used as verified; `ai_suggested` (kept from an answer) are never used until confirmed. Deleting a conversation keeps its facts unless `?delete_facts=1`.

## Actions
`lib/career/actions.ts` reads only what the user typed and returns links/suggestions. Nothing is executed by chat, models or retrieved text. "Send this email" becomes "edit as draft, then review and send".

## Email
Gmail via OAuth with the `gmail.send` scope only (cannot read the mailbox). Fallback: the user's own encrypted App Password. No server-wide mailbox. Flow: draft (editable, saved) -> Preview (exact message, From, To, CC, content hash) -> tick confirmation -> Send. Server rules (`lib/comms/send.ts`): confirm + hash required; row locked and claimed (`draft|failed -> sending`), so retries and double clicks cannot send twice; `sent` only after Gmail returns a message id; provider refusal -> `failed` (retry safe; 429/5xx retried up to 3 times with backoff); lost contact -> `unknown`, never auto-retried and needs an explicit acknowledgement; revoked grant -> account `revoked`, token dropped; 40 sends/24 h per user, 12/h per IP. Refresh tokens: AES-256-GCM, bound to the user and purpose, never sent to the browser or logged. Disconnect revokes at Google (reported honestly) and deletes the token. LinkedIn messages are copy-ready with a link; nothing is sent. Reading existing threads through the Gmail API is NOT implemented (restricted scope needing Google verification): paste the thread instead.

## Database (additive, idempotent in `lib/database/schema.sql`)
`kb_conversations.summary/summary_msg_id`, `kb_facts`, `app_answer_sets`, `app_answers`, `email_accounts`, `email_drafts`.

## Environment
`GROQ_API_KEY` or `GEMINI_API_KEY` (+ optional `GROQ_MODEL`/`GEMINI_MODEL`), `CREDENTIAL_ENCRYPTION_KEY` (or `KB_ENCRYPTION_KEY`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL`. Google redirect URI: `<APP_URL>/api/comms/gmail/callback`.

## Tests
`npm test` (adds `scripts/test-career.ts`, 28), `npm run test:career-db` (19, real PostgreSQL), browser: `scripts/e2e/seed-career.ts` + `scripts/e2e/career-browser.mjs`.

## Not verified / limits
No live Groq/Gemini, Google OAuth or Gmail call was made (no credentials/network): those paths are tested with fakes only. No live email was sent. Retrieval is still full-text, not semantic. Gmail thread reading, Google Drive connector, Microsoft Graph and portal automation are not built. Sent emails are not yet written into the outreach tracker/analytics. Known pre-existing: Radix Sheet scroll-lock injects an un-nonced `<style>` that the CSP blocks (console message under 1024px).

## Update: whole-knowledge-base answers, citations, export
- Questions that don't name a project (and broad ones: career, behavioural, resume, job match) start from one document per project plus the resume/profile, then add keyword matches, so one README no longer dominates.
- The resume is listed first and given more room; the project-overview prompt covers every project, including ones that exist only in the resume.
- `[S1, S2, S3]` is split into separate, individually validated citations, shown as source pills.
- Chat: wider column, viewport-fitted height, per-answer and whole-chat copy / Markdown export (with a Sources list).
- AI provider timeout raised to 45s; if one provider's key is rejected (401) the message says so even when the other failed differently.

## Update 2: Atlas
- Renamed to **Atlas** (route unchanged: /career-ai).
- Resume projects (under a "Projects" heading) and skills are now extracted into the knowledge entities as self-reported; a repository with the same name raises it to demonstrated.
- "My projects" falls back to a deterministic list read from the knowledge base when no AI provider answers.
- The chat page is a fixed-height flex layout: the page doesn't scroll, only the conversation and the side panel do.
- `npm run check:ai` tests the keys in .env against Groq and Gemini and prints only the HTTP status.

## Update 3: inventory, source limits, quality stage
- `lib/kb/inventory.ts`: "list all my projects" is built from the complete entity records (GitHub + resume), merged only on exact normalized name, rendered as one table with the real count. No model call, so no omissions from context limits and no dependence on a provider.
- `lib/kb/constraints.ts`: "only use GitHub / my resume" restricts evidence (no silent fallback); "use my resume" prioritises it.
- `lib/kb/quality.ts`: every model answer passes dedupe of repeated headings/paragraphs, secret and prompt-text stripping, fence repair, and a report of figures absent from the sources.
- See docs/PRIVACY_AND_RETENTION.md.
