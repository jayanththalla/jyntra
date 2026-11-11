# Voice interview

Path: Career tools > Mock interview > Voice interview (`/mock-interview/voice`). It is not in the main navigation or on the landing page.

## Flow
1. Choose mode (technical, project deep dive, behavioral, spoken English), difficulty, role, topics, an optional instruction (any language) and optional job description.
2. The interviewer asks ONE question in English. With server voice it is spoken (replay / pause / stop; one sound at a time); otherwise it is shown as text.
3. You record an answer. The server transcribes it and returns text. You accept, edit, or discard and re-record. Only an accepted answer is stored and sent to the interviewer.
4. Follow-ups are generated from accepted answers. The session is bounded by turns and minutes. Ending it produces an evaluation.

## Evaluation
Two separate parts, qualitative only (no numeric scores):
- Spoken English: clarity, grammar, vocabulary, filler words counted from the transcript, and a cautious CEFR estimate labelled as an AI estimate (forced to "insufficient" for very little speech). Nothing about pronunciation, accent or speaking rate: only text is analysed.
- Answer quality: relevance, depth, structure, evidence and trade-offs, strongest and weakest answer, an improved answer, topics to practise.
Reports can be copied and exported (Markdown or JSON).

## Configuration
See `.env.example`. A text-only interview needs only `GROQ_API_KEY` or `GEMINI_API_KEY`. Spoken interviews also need `SARVAM_API_KEY`. Capabilities are logged at start-up (no values) and shown on the page. Free Sarvam credits are limited; quota errors fall back to text.

## Privacy
Audio is sensitive. By default recordings are discarded right after transcription. Saving recordings needs an explicit consent checkbox, expires after `VOICE_AUDIO_RETENTION_DAYS`, is size-limited, and can be deleted per session at any time. Raw audio, transcripts and keys are never logged. Every endpoint authenticates and checks ownership.

## Status
Mocked-provider and PostgreSQL tests pass (`npm run test`, `npm run test:voice-db`). It has NOT been verified end to end with a real microphone, the real Sarvam API and a real interviewer model, so it should not be described as fully integrated until an authorised end-to-end run confirms that.
