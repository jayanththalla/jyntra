# Career AI: knowledge base and career intelligence (Phase 7)

## Architecture
Connectors (`lib/kb/connectors/*`) fetch raw documents -> `lib/kb/safety.ts` excludes secret files and redacts secrets -> `lib/kb/store.ts` stores documents by content hash, splits them into chunks (`lib/kb/chunk.ts`) and rebuilds evidence-level entities -> `lib/kb/search.ts` retrieves with PostgreSQL full-text search -> `lib/kb/answer.ts` classifies the question, builds a fenced evidence prompt, calls Groq/Gemini and validates citations. All tables are scoped by `user_id` and every query filters on it.

## Connectors: what is built and what was tested
| Source | How | Tested |
|---|---|---|
| Document upload (txt, md, pdf, docx, 5 MB max) | `lib/kb/extract.ts` | Live smoke test (txt); extraction unit-tested |
| GitHub | OAuth app, or public username, or personal access token | Mocked GitHub API only (sync, secrets exclusion, rate limit, revoke). **Not run against github.com.** |
| Codeforces | Documented public API | Mocked API only |
| LeetCode | Manual import of a user-provided export; no scraping | Parser unit-tested |
| LinkedIn | Manual paste/upload only; no scraping | Manual path |
| Portfolio URL | Public page fetch with SSRF checks | Mocked |
| Notes | Typed notes | Yes |
| Google Drive | **Not implemented** | - |

## Environment variables
`KB_ENCRYPTION_KEY` (required for GitHub/Codeforces credentials; 32+ chars; the feature fails closed without it), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `APP_URL` (optional), plus `GROQ_API_KEY` or `GEMINI_API_KEY` for answers. GitHub OAuth app callback URL: `<APP_URL>/api/kb/github/callback`.

## Schema
`kb_sources`, `kb_documents`, `kb_chunks` (generated `tsvector` + GIN), `kb_entities`, `kb_conversations`, `kb_messages`, `kb_notes`, `kb_audit` in `lib/database/schema.sql` (idempotent, applied at start-up).

## Sync behaviour
Incremental by content hash: unchanged documents are not rewritten; changed ones are updated; a complete listing removes documents deleted at the source. Retry with backoff and Retry-After for provider limits, partial results kept with a warning, cancel supported, one sync per source at a time, stale runs taken over after 15 minutes. A revoked or unauthorized token marks the source `revoked` and clears the credential. A failed sync is never shown as healthy. Identical content in a second source is stored once (duplicate).

## Retrieval and citations
Keyword OR-query ranked by `ts_rank_cd`, boosted by document type, freshness, provider reliability and title match; at most 3 chunks per document. pgvector is not used (not available in the test environment). Answers cite `[S#]` ids that map to the user's own documents; invalid ids are dropped, only allowlisted links survive, and with no evidence the server replies "insufficient evidence" without calling the model. Skills are labelled demonstrated, self-reported, inferred or unverified.

## Routes and components
Page `/career-ai`; APIs under `/api/kb/*` (sources, github/authorize + callback, documents, search, ask, conversations, notes, summary, data). Components in `components/career-ai/*`, a dashboard widget, Jobs "My fit", Startup "Relevant experience", Outreach "Use my verified experience" (insert only, never sends), Tracker prep notes.

## Tests (mocked providers, real PostgreSQL)
`npm test` (unit: 77 + 49 + `test:kb` 19 + `test:kb-connectors` 29), `npm run test:db` (71), `npm run test:kb-db` (18: isolation, incremental sync, duplicates, revoke, rate limit, concurrency, disconnect/purge, delete-all, audit).

## Limitations and outstanding work
No Google Drive. No live provider calls were made. Full-text search only (no embeddings). DOCX size guard checks declared sizes, not actual decompression. UI verified by build and HTTP smoke test only, not in a browser. Answers need a Groq or Gemini key.
