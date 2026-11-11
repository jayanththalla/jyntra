# Interview v2: what exists, how it works, what is and is not verified

## Pages
- `/mock-interview/formal`: resume review → 10/20/30-minute formal session (3/5/8 main questions) → written + SQL stage → saved report + PDF.
- `/mock-interview/voice`: existing voice interview, now with a **Live voice (beta)** panel (WebRTC) when `OPENAI_API_KEY` is set.
- `/mock-interview`: unchanged practice mode (75/100 threshold already existed).

## Resume upload and profile (`lib/resume/profile.ts`, `/api/interview/resume`)
PDF and DOCX only, 5 MB, type decided by file **content** (magic bytes + `word/document.xml`), never by extension. The file is parsed in memory and
discarded. Only the profile the user reviewed and saved is stored (`interview_resume_profiles`, owner-scoped). E-mail, phone and links are not extracted.
Skills are literal matches only (Node.js does not imply JavaScript). If the user already gave Atlas a resume (`kb_documents`, `doc_type='resume'`) it is offered
automatically. Role recommendations are rules over the profile: every matching skill, project and internship is quoted from it; missing skills are listed;
difficulty comes from stated years/experience.

## Scoring (`lib/interview/rubric.ts`)
0-100. Technical (35/20/20/15/10) and behavioural (20/15/25/25/15) rubrics; communication = clarity, grammar, vocabulary, structure, conciseness.
The overall is **computed** from validated components; the model never supplies it. A component ≥ 70 must carry a quote that really appears in the answer.
If the model reply fails validation, **nothing is saved and no fallback score is invented**: the API returns `evaluation_failed` (retryable) and the UI keeps the text.
Practice threshold 75; retry offered below it; skipping/continuing is always allowed; retries capped at 3.
**Migration**: `interview_answers.score` was already constrained to 0-100, so old rows are *not* rescaled. They keep their values and are labelled
`rubric_version = 'legacy'`; new rows are `'v2'` with the per-dimension breakdown. Reports label legacy answers and exclude them from dimension averages.

## Spoken English (`lib/interview/english.ts`)
Transcript-based. A CEFR level needs ≥ 3 answers and ≥ 150 words, otherwise `insufficient`. Confidence is capped at `medium`. Cited mistakes must quote the transcript.
Pace is only reported from measured speaking seconds. Pronunciation/accent/intonation are never assessed. Label: "AI-estimated practice level — not an official CEFR certification."

## Written tests and SQL
Bank of 34 hand-written questions across DSA, DBMS, OOP, OS, Networks, Java, Python, JavaScript, SQL, System design, AI/ML (single, multi, true/false, short).
AI-generated questions are accepted only after strict schema validation and are stored with source `ai`. Answers and explanations are returned only after submission.
SQL: 12 problems. Queries run in **sql.js (SQLite/WASM) inside a terminable worker thread**: in-memory DB, one `SELECT`/`WITH…SELECT` only, 2.5 s timeout,
200-row cap, 96 MB memory cap, empty environment. It is **SQLite, not PostgreSQL**, and never touches the application database. Expected output is produced by running
the reference solution on each dataset; 2 hidden datasets catch hard-coding, NULL/tie/empty-group mistakes.

## Reports and PDF
`buildReportV2` builds from saved rows only; paused/active/abandoned sessions throw. PDF is rendered server-side with pdfkit from the same object
(`GET /api/interview/sessions/pdf?id=`). Version-1 reports are returned untouched; they have no PDF layout (409 with an explanation).

## Realtime voice (`lib/voice/realtime*.ts`, `components/voice/RealtimePanel.tsx`)
Server mints a ~2-minute client secret (`POST /v1/realtime/client_secrets`); the browser POSTs its SDP offer to `/v1/realtime/calls` with it. Questions come from the
server-side interviewer and are spoken on request, so there is one source of truth. VAD does not auto-reply; speech start while the interviewer talks cancels the
response and clears audio (barge-in), and that response id is remembered as stale. Transcript review is the default; auto-submit is opt-in; duplicate events are ignored by item id.
**Not verified against the live API** (no key in the build environment): only mocked/fake-WebRTC tests exist.

## Run
```
npm run db:migrate         # applies schema + ingestion + interview-v2 (idempotent)
npm run test:interview-v2  # pure logic, PDF, realtime (mocked)
DATABASE_URL=… npm run test:interview-v2-db
```
