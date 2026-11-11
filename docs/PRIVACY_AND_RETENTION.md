# Atlas: privacy, retention and deletion (what the code does)

**Stored:** documents and passages you connect or upload (kb_documents, kb_chunks), derived records (kb_entities), conversations and messages, saved facts, application answers, email drafts/history, and encrypted integration credentials. Every row carries `user_id`; every query filters on it.

**Sent to AI providers (Groq, Gemini):** the question, a bounded set of retrieved excerpts (per-item and total character caps), your confirmed facts and a short conversation summary. Whole resumes or repositories are not sent when excerpts suffice. "List all my projects" is built from stored records and sends nothing to a provider. Secrets are redacted before storage and again on the way out.

**Deletion (tested in `npm run test:kb-db`):** removing a source deletes its documents, passages and derived entities; purge also deletes answers/notes derived from them; "Delete everything" removes all of one user's knowledge and nothing of another's. Tokens are encrypted (AES-256-GCM, key outside the database); disconnecting clears them.

**Limits:** deleting here does not delete copies held by GitHub, Google, Groq or Gemini; use those services' own controls. Provider-side retention follows their terms. Backups of the database, if you take them, hold deleted data until they expire.

**Training:** the app does not train or fine-tune any model on your data.
