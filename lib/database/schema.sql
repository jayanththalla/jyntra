-- Daily Startup Finder schema. Idempotent: safe to run on every start.
-- NULL means "unknown / not verified". The UI renders NULL as "Unknown".

CREATE TABLE IF NOT EXISTS candidate_profile (
  id          SERIAL PRIMARY KEY,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,          -- e.g. 'yc', 'remotive', 'funding_rss'
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,             -- 'directory' | 'job_board' | 'news' | 'search' | 'company'
  base_url      TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  last_run_at   TIMESTAMPTZ,
  last_status   TEXT,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS startups (
  id                        SERIAL PRIMARY KEY,
  name                      TEXT NOT NULL,
  normalized_name           TEXT NOT NULL,
  website                   TEXT,
  domain                    TEXT,
  linkedin_url              TEXT,
  careers_url               TEXT,
  description               TEXT,
  location                  TEXT,
  remote_available          BOOLEAN,       -- true only if a job/source explicitly says remote
  industry                  TEXT,
  is_ai                     BOOLEAN,
  ai_category               TEXT,
  classification_confidence TEXT,          -- 'high' | 'medium' | 'low'
  classification_reasons    JSONB NOT NULL DEFAULT '[]',
  founded_year              INT,
  is_new_startup            BOOLEAN,
  funding_status            TEXT,          -- computed on read too; stored for convenience
  last_funding_date         DATE,
  last_funding_amount       TEXT,          -- verbatim from source, e.g. '₹25 Cr'
  funding_round             TEXT,
  investors                 TEXT[],
  funding_source            TEXT,
  funding_source_url        TEXT,
  source                    TEXT NOT NULL, -- first source that found it
  source_url                TEXT,
  sources_seen              TEXT[] NOT NULL DEFAULT '{}',
  field_sources             JSONB NOT NULL DEFAULT '{}', -- field -> source URL
  raw_tags                  TEXT[] NOT NULL DEFAULT '{}',
  first_discovered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_change_reason        TEXT,
  show_again                BOOLEAN NOT NULL DEFAULT false
);
-- Contact emails found on the startup's own site: [{email, type, source_url, domain_accepts_mail}]
ALTER TABLE startups ADD COLUMN IF NOT EXISTS emails JSONB NOT NULL DEFAULT '[]';
ALTER TABLE startups ADD COLUMN IF NOT EXISTS emails_checked_at TIMESTAMPTZ;
-- Headquarters country (India / United States) with the evidence behind it. `location` stays the HQ text.
ALTER TABLE startups ADD COLUMN IF NOT EXISTS hq_country TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS hq_confidence TEXT;           -- 'high' | 'medium' | 'low'
ALTER TABLE startups ADD COLUMN IF NOT EXISTS hq_evidence TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS hq_source_url TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS other_locations TEXT[] NOT NULL DEFAULT '{}';
-- Founders only from structured public pages (YC): [{name, title, profile_url, source_url}]
ALTER TABLE startups ADD COLUMN IF NOT EXISTS founders JSONB NOT NULL DEFAULT '[]';
-- Company GitHub account as listed on its YC page.
ALTER TABLE startups ADD COLUMN IF NOT EXISTS github_url TEXT;
-- Funding details. last_funding_* above stay the primary round; every report is kept for verification.
ALTER TABLE startups ADD COLUMN IF NOT EXISTS funding_stage TEXT;           -- pre_seed | seed | series_a | series_b_plus | accelerator | debt | other
ALTER TABLE startups ADD COLUMN IF NOT EXISTS funding_kind TEXT;            -- confirmed | planned | rumored
ALTER TABLE startups ADD COLUMN IF NOT EXISTS funding_currency TEXT;        -- INR | USD | EUR | GBP
ALTER TABLE startups ADD COLUMN IF NOT EXISTS funding_amount_value NUMERIC; -- in funding_currency units
ALTER TABLE startups ADD COLUMN IF NOT EXISTS funding_amount_usd NUMERIC;   -- only when a free FX rate was available
ALTER TABLE startups ADD COLUMN IF NOT EXISTS funding_verification_url TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS funding_conflicts JSONB NOT NULL DEFAULT '[]';
ALTER TABLE startups ADD COLUMN IF NOT EXISTS funding_reports JSONB NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS startups_hq_country_idx ON startups (hq_country);
CREATE UNIQUE INDEX IF NOT EXISTS startups_domain_uq ON startups (domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS startups_norm_idx ON startups (normalized_name);
CREATE INDEX IF NOT EXISTS startups_linkedin_idx ON startups (linkedin_url);

CREATE TABLE IF NOT EXISTS jobs (
  id               SERIAL PRIMARY KEY,
  startup_id       INT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  job_title        TEXT NOT NULL,
  job_url          TEXT NOT NULL UNIQUE,
  apply_url        TEXT,
  location         TEXT,
  remote           TEXT NOT NULL DEFAULT 'unknown', -- 'yes' | 'no' | 'unknown'
  remote_scope     TEXT,                            -- 'India' | 'Worldwide' | 'US' | ... | NULL
  employment_type  TEXT,
  posted_date      TEXT,                            -- as given by source (may be relative)
  min_experience   TEXT,
  salary           TEXT,                            -- only if the source states it
  skills           TEXT[] NOT NULL DEFAULT '{}',
  description      TEXT,
  source           TEXT NOT NULL,
  source_url       TEXT,
  discovered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active        BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS jobs_startup_idx ON jobs (startup_id);

CREATE TABLE IF NOT EXISTS applications (
  id               SERIAL PRIMARY KEY,
  startup_id       INT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  job_id           INT REFERENCES jobs(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'Saved',
  applied_at       DATE,
  application_url  TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ---------- multi-user ----------
-- Each visitor is a user (no passwords). Startups and jobs are shared; profile, pins and
-- applications are per user.
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  token       TEXT UNIQUE,                 -- legacy plain token; emptied by the migration below
  profile     JSONB NOT NULL,
  pinned      INT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ALTER COLUMN token DROP NOT NULL;

-- One session per signed-in browser. The cookie holds a random token; only its SHA-256 is stored,
-- so a database leak doesn't hand out working logins. Signing out deletes the row.
CREATE TABLE IF NOT EXISTS sessions (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- Private link: its own random token (hash only), separate from any session. Asking for a new
-- link replaces it, so the old link stops working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS link_token_hash TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS link_created_at TIMESTAMPTZ;

-- Migration from plain tokens (idempotent): each old token becomes a hashed session, and keeps
-- working as that user's private link until they ask for a new one. Then the plain token is erased.
INSERT INTO sessions (user_id, token_hash)
  SELECT id, encode(sha256(convert_to(token, 'UTF8')), 'hex') FROM users WHERE token IS NOT NULL
  ON CONFLICT (token_hash) DO NOTHING;
UPDATE users
  SET link_token_hash = COALESCE(link_token_hash, encode(sha256(convert_to(token, 'UTF8')), 'hex')),
      link_created_at = COALESCE(link_created_at, created_at),
      token = NULL
  WHERE token IS NOT NULL;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS applications_startup_job_uq;
CREATE UNIQUE INDEX IF NOT EXISTS applications_user_startup_job_uq
  ON applications (COALESCE(user_id, 0), startup_id, COALESCE(job_id, 0));

-- ---------- open source ----------
-- YC companies tagged Open Source and the GitHub account their YC page lists (null = none listed).
CREATE TABLE IF NOT EXISTS oss_orgs (
  slug          TEXT PRIMARY KEY,            -- YC company slug
  company_name  TEXT NOT NULL,
  github_org    TEXT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  searched_at   TIMESTAMPTZ
);
-- One row per GitHub repo with an open beginner issue, plus the one issue we suggest.
CREATE TABLE IF NOT EXISTS oss_projects (
  repo              TEXT PRIMARY KEY,        -- "owner/name"
  github_org        TEXT NOT NULL,
  company_name      TEXT NOT NULL,
  company_yc_url    TEXT,
  company_website   TEXT,
  one_liner         TEXT,
  yc_batch          TEXT,
  hiring            BOOLEAN NOT NULL DEFAULT false,
  beginner_issues   INT NOT NULL DEFAULT 0,  -- open, unassigned beginner issues found in this repo
  issue_title       TEXT NOT NULL,
  issue_url         TEXT NOT NULL,
  issue_labels      TEXT[] NOT NULL DEFAULT '{}',
  issue_comments    INT NOT NULL DEFAULT 0,
  issue_updated_at  TIMESTAMPTZ,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 'yc' = a YC open-source company's repo; 'popular' = an active, well-starred GitHub project.
ALTER TABLE oss_projects ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'yc';
ALTER TABLE oss_projects ADD COLUMN IF NOT EXISTS stars INT;
ALTER TABLE oss_projects ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE oss_projects ADD COLUMN IF NOT EXISTS repo_description TEXT;
-- Programme collections GitHub itself ties the repo to (see lib/oss/filters.ts): gssoc | mlh | cncf | apache.
ALTER TABLE oss_projects ADD COLUMN IF NOT EXISTS collections TEXT[] NOT NULL DEFAULT '{}';

-- One row per "Find Startups Today" run, so the dashboard can say what is new today.
CREATE TABLE IF NOT EXISTS discovery_runs (
  id           SERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'running',
  log          JSONB NOT NULL DEFAULT '[]',
  stats        JSONB NOT NULL DEFAULT '{}'
);

-- Outreach messages: tracks cold emails sent directly via personal Gmail, LinkedIn DMs, Twitter DMs, etc.
CREATE TABLE IF NOT EXISTS outreach_messages (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id  INT REFERENCES applications(id) ON DELETE SET NULL,
  startup_id      INT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  job_id          INT REFERENCES jobs(id) ON DELETE SET NULL,
  channel         TEXT NOT NULL DEFAULT 'email', -- 'email' | 'linkedin_dm' | 'twitter_dm' | 'other'
  recipient_email TEXT,
  recipient_name  TEXT,
  subject         TEXT,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'sent', -- 'draft' | 'sent' | 'delivered' | 'replied'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outreach_messages_user_idx ON outreach_messages(user_id);
CREATE INDEX IF NOT EXISTS outreach_messages_startup_idx ON outreach_messages(startup_id);
CREATE INDEX IF NOT EXISTS outreach_messages_app_idx ON outreach_messages(application_id);


-- =====================================================================================
-- Data-quality migration (additive and idempotent; no existing data is changed or dropped)
-- =====================================================================================

-- Jobs: stable source identifier, canonical URL, and how trustworthy the posting date is.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_id      TEXT;   -- the source's own id, e.g. 'greenhouse:acme:12345'
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS canonical_url    TEXT;   -- job_url with tracking params stripped (comparison only)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_precision TEXT;   -- 'exact' | 'approx' (converted from "3 days ago") | NULL (unknown)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS verification     TEXT;   -- 'ats_api' | 'source_api' | 'source_page' | 'structured_data'
CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_ext_uq ON jobs (source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_canonical_idx ON jobs (canonical_url);

-- Startups: currency is stored only when the source text states it (e.g. "$5M", "₹25 Cr").
ALTER TABLE startups ADD COLUMN IF NOT EXISTS last_funding_currency TEXT;

-- Funding articles: one row per story. NULL published_at means the publisher gave no date.
CREATE TABLE IF NOT EXISTS funding_articles (
  id                SERIAL PRIMARY KEY,
  canonical_url     TEXT NOT NULL UNIQUE,
  url               TEXT NOT NULL,                 -- original link, never rewritten
  headline          TEXT NOT NULL,
  publisher         TEXT NOT NULL,
  summary           TEXT,
  published_at      TIMESTAMPTZ,
  company_name      TEXT,                          -- parsed from the headline only when it states a raise
  startup_id        INT REFERENCES startups(id) ON DELETE SET NULL,
  funding_amount    TEXT,                          -- verbatim from the headline/summary
  funding_currency  TEXT,
  funding_round     TEXT,
  provider          TEXT NOT NULL,                 -- 'rss' | 'tavily'
  first_ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Added later (additive): what the story says about the round, and the same round as reported by other outlets.
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS investors         TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS announcement_kind TEXT NOT NULL DEFAULT 'confirmed';   -- confirmed | planned | rumored
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS amount_value      NUMERIC;                             -- in funding_currency units; NULL when unreadable
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS also_reported     JSONB NOT NULL DEFAULT '[]';         -- [{publisher,url}] other outlets covering the same round
CREATE INDEX IF NOT EXISTS funding_articles_pub_idx ON funding_articles (published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS funding_articles_startup_idx ON funding_articles (startup_id);

-- Possible duplicates we were NOT sure about. Logged for a human; nothing is merged or deleted automatically.
CREATE TABLE IF NOT EXISTS duplicate_candidates (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,                       -- 'job' | 'startup' | 'article'
  ref_a       TEXT NOT NULL,
  ref_b       TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_a, ref_b)
);

-- Per-source health for the refresh mechanism.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_success_at     TIMESTAMPTZ;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_error          TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_duration_ms    INT;
-- Provider diagnostics (additive). The category is a fixed word (timeout, rate_limited, ...), never a response body or key.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_error_category TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS next_retry_at       TIMESTAMPTZ;
-- Per-feed health inside one news provider (one row per RSS feed).
CREATE TABLE IF NOT EXISTS feed_health (
  provider             TEXT NOT NULL,
  feed                 TEXT NOT NULL,
  last_run_at          TIMESTAMPTZ,
  last_success_at      TIMESTAMPTZ,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_error_category  TEXT,
  served_cache         BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (provider, feed)
);
-- Funding article provenance (additive): the text fingerprint used to merge copies, when a discovery provider first saw the
-- URL (NOT a publication date) and where the stored date came from.
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS provider_seen_at    TIMESTAMPTZ;
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS date_source         TEXT;   -- 'publisher' | NULL (no date given)
CREATE INDEX IF NOT EXISTS funding_articles_fp_idx ON funding_articles (content_fingerprint) WHERE content_fingerprint IS NOT NULL;

-- Story enrichment (additive). Filled by lib/news/enrich.ts at the end of every news refresh.
--   city:   a taxonomy id (see lib/news/taxonomy.ts), only when the story or the company record ties a city to the company. NULL = unknown.
--   sector: a taxonomy id. sector_source says how: 'rules' (keywords), 'ai' (model, constrained to the taxonomy), 'none' (AI found no fit).
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS city           TEXT;
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS city_source    TEXT;   -- 'story' | 'company_record'
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS sector         TEXT;
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS sector_source  TEXT;   -- 'rules' | 'ai' | 'none'
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS enriched_at    TIMESTAMPTZ;
ALTER TABLE funding_articles ADD COLUMN IF NOT EXISTS enrich_version INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS funding_articles_city_idx   ON funding_articles (city)   WHERE city IS NOT NULL;
CREATE INDEX IF NOT EXISTS funding_articles_sector_idx ON funding_articles (sector) WHERE sector IS NOT NULL;

-- AI analysis of one story, cached. input_hash covers every fact the model saw, so an updated story is analysed again.
CREATE TABLE IF NOT EXISTS funding_article_analysis (
  article_id  INT PRIMARY KEY REFERENCES funding_articles(id) ON DELETE CASCADE,
  input_hash  TEXT NOT NULL,
  provider    TEXT NOT NULL,
  result      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outreach provenance: 'smtp' = the app handed it to Gmail and Gmail accepted it; 'manual' = the user told us they
-- sent it elsewhere (LinkedIn, Gmail compose window). Drafts have no delivery. One draft per (user, startup, job, channel).
ALTER TABLE outreach_messages ADD COLUMN IF NOT EXISTS delivery TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS outreach_draft_uq ON outreach_messages (user_id, startup_id, COALESCE(job_id, 0), channel) WHERE status = 'draft';

-- ============================================================================
-- Career knowledge base (Phase 7). EVERY table is scoped by user_id; every query filters on it.
-- Search is PostgreSQL full-text (no pgvector dependency): chunks.tsv is a generated column.
-- ============================================================================
CREATE TABLE IF NOT EXISTS kb_sources (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,            -- github | upload | codeforces | leetcode | linkedin | portfolio | notes | gdocs
  label           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | connected | syncing | error | disconnected | revoked
  config          JSONB NOT NULL DEFAULT '{}',     -- non-secret settings (handle, repo allow-list, scope)
  credentials_enc TEXT,                            -- AES-256-GCM envelope; NEVER returned by any API
  last_synced_at  TIMESTAMPTZ,                     -- last SUCCESSFUL sync
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  last_stats      JSONB NOT NULL DEFAULT '{}',
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Index freshness (additive): when a cheap probe last looked at the provider, and when it saw a change newer than our last sync.
ALTER TABLE kb_sources ADD COLUMN IF NOT EXISTS last_probe_at       TIMESTAMPTZ;
ALTER TABLE kb_sources ADD COLUMN IF NOT EXISTS update_observed_at  TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS kb_sources_user_idx ON kb_sources (user_id);

CREATE TABLE IF NOT EXISTS kb_documents (
  id             SERIAL PRIMARY KEY,
  user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id      INT NOT NULL REFERENCES kb_sources(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  doc_type       TEXT NOT NULL,             -- readme | code | manifest | doc | issue | pull_request | commits | profile | resume | note | coding_stats
  external_id    TEXT NOT NULL,             -- provider's own id (repo/path, file name, handle)
  title          TEXT NOT NULL,
  url            TEXT,
  project        TEXT,                      -- repo or project name this belongs to
  content        TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  metadata       JSONB NOT NULL DEFAULT '{}',   -- technologies, language, etc.
  source_modified_at TIMESTAMPTZ,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL DEFAULT 'indexed', -- indexed | failed | skipped
  error          TEXT,
  UNIQUE (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS kb_documents_user_idx ON kb_documents (user_id, doc_type);
CREATE INDEX IF NOT EXISTS kb_documents_hash_idx ON kb_documents (user_id, content_hash);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id INT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  idx         INT NOT NULL,
  locator     TEXT,                         -- "L10-L70", "section: Setup", "page 2"
  content     TEXT NOT NULL,
  tsv         TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX IF NOT EXISTS kb_chunks_tsv_idx ON kb_chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS kb_chunks_user_doc_idx ON kb_chunks (user_id, document_id);

-- Derived: projects, skills, experience... rebuilt from documents + profile. level says how we know it.
CREATE TABLE IF NOT EXISTS kb_entities (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                -- project | skill | experience | education | achievement | coding
  name        TEXT NOT NULL,
  level       TEXT NOT NULL,                -- demonstrated | self_reported | inferred | unverified
  data        JSONB NOT NULL DEFAULT '{}',
  document_ids INT[] NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kb_entities_uq ON kb_entities (user_id, kind, lower(name));

CREATE TABLE IF NOT EXISTS kb_conversations (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_conversations_user_idx ON kb_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS kb_messages (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id INT NOT NULL REFERENCES kb_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,            -- user | assistant
  content         TEXT NOT NULL,
  citations       JSONB NOT NULL DEFAULT '[]',
  meta            JSONB NOT NULL DEFAULT '{}',
  document_ids    INT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_messages_conv_idx ON kb_messages (conversation_id, id);

CREATE TABLE IF NOT EXISTS kb_notes (
  id             SERIAL PRIMARY KEY,
  user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INT REFERENCES applications(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'interview_note', -- interview_note | prep | job_description | question | answer
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  citations      JSONB NOT NULL DEFAULT '[]',
  document_ids   INT[] NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_notes_user_idx ON kb_notes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kb_notes_app_idx ON kb_notes (application_id);

-- Audit trail: what happened, never credentials or prompt text.
CREATE TABLE IF NOT EXISTS kb_audit (
  id        BIGSERIAL PRIMARY KEY,
  user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action    TEXT NOT NULL,
  source_id INT,
  detail    TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Career GPT (additive migration; nothing above is altered destructively) ----------
-- Rolling conversation memory: a short deterministic summary of messages older than the recent window.
ALTER TABLE kb_conversations ADD COLUMN IF NOT EXISTS summary        TEXT NOT NULL DEFAULT '';
ALTER TABLE kb_conversations ADD COLUMN IF NOT EXISTS summary_msg_id INT  NOT NULL DEFAULT 0;

-- Facts the candidate chose to keep. origin says how we know:
--   user_confirmed = typed or confirmed by the candidate (used as a verified fact)
--   ai_suggested   = saved from a model answer; NEVER used as a fact until the candidate confirms it
CREATE TABLE IF NOT EXISTS kb_facts (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL DEFAULT 'general',   -- general | salary | notice_period | availability | work_authorization | relocation | preference | achievement
  text       TEXT NOT NULL,
  origin     TEXT NOT NULL DEFAULT 'user_confirmed' CHECK (origin IN ('user_confirmed', 'ai_suggested')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE kb_facts ADD COLUMN IF NOT EXISTS conversation_id INT REFERENCES kb_conversations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS kb_facts_user_idx ON kb_facts (user_id, created_at DESC);

-- Application question sets (one pasted form / job) and their answers.
CREATE TABLE IF NOT EXISTS app_answer_sets (
  id                 SERIAL PRIMARY KEY,
  user_id            INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id     INT REFERENCES applications(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  jd_text            TEXT NOT NULL DEFAULT '',
  resume_document_id INT REFERENCES kb_documents(id) ON DELETE SET NULL,
  source_ids         INT[] NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_answer_sets_user_idx ON app_answer_sets (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS app_answers (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id      INT NOT NULL REFERENCES app_answer_sets(id) ON DELETE CASCADE,
  position    INT NOT NULL,
  question    TEXT NOT NULL,
  word_limit  INT,
  char_limit  INT,
  intent      TEXT NOT NULL DEFAULT 'general',
  answer      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'needs_input')),
  missing     JSONB NOT NULL DEFAULT '[]',
  warnings    JSONB NOT NULL DEFAULT '[]',
  citations   JSONB NOT NULL DEFAULT '[]',
  document_ids INT[] NOT NULL DEFAULT '{}',
  edited      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_answers_set_idx ON app_answers (set_id, position);

-- Connected email accounts. The OAuth refresh token is stored only as AES-256-GCM ciphertext (lib/secrets/vault.ts).
CREATE TABLE IF NOT EXISTS email_accounts (
  id                SERIAL PRIMARY KEY,
  user_id           INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL DEFAULT 'gmail_oauth',
  email             TEXT NOT NULL,
  refresh_token_enc TEXT,
  status            TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'revoked', 'error')),
  last_error        TEXT,
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_accounts_uq ON email_accounts (user_id, provider);

-- Email drafts and their real sending state. status moves draft -> sending -> sent | failed | unknown.
--   sent    = the provider confirmed (provider_message_id is set)
--   failed  = the provider refused or was unreachable BEFORE accepting: safe to retry
--   unknown = we lost contact mid-send: the message may or may not have left; retry only after the user acknowledges that
CREATE TABLE IF NOT EXISTS email_drafts (
  id                  SERIAL PRIMARY KEY,
  user_id             INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL DEFAULT 'cold_email',
  to_email            TEXT,
  recipient_name      TEXT,
  cc                  TEXT[] NOT NULL DEFAULT '{}',
  subject             TEXT NOT NULL DEFAULT '',
  body                TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'failed', 'unknown')),
  application_id      INT REFERENCES applications(id) ON DELETE SET NULL,
  startup_id          INT REFERENCES startups(id) ON DELETE SET NULL,
  job_id              INT REFERENCES jobs(id) ON DELETE SET NULL,
  context             JSONB NOT NULL DEFAULT '{}',
  citations           JSONB NOT NULL DEFAULT '[]',
  via                 TEXT,                      -- gmail_api | smtp
  from_email          TEXT,
  provider_message_id TEXT,
  provider_thread_id  TEXT,
  error_code          TEXT,
  attempts            INT NOT NULL DEFAULT 0,
  claimed_at          TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_drafts_user_idx ON email_drafts (user_id, updated_at DESC);

-- ---------- Historical application import (additive) ----------
-- NOTE: the import UI and API were removed. These columns and tables are kept so existing records are preserved; nothing writes to application_import_candidates any more.
-- Imported history lives in `applications` next to tracked ones, but is never claimed as applied:
--   status = 'To Verify' and status_certainty = 'unknown' until the user says otherwise.
-- startup_id becomes optional: a historical company need not exist in the shared startup directory.
-- (The existing unique index treats NULL startup_id rows as distinct; import dedupe is enforced by import_key below.)
ALTER TABLE applications ALTER COLUMN startup_id DROP NOT NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS company_name        TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS role_title          TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS contact_email       TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS record_source       TEXT;   -- historical_summary | manual | discovery ...
ALTER TABLE applications ADD COLUMN IF NOT EXISTS verification_state  TEXT;   -- unverified | verified | stale
ALTER TABLE applications ADD COLUMN IF NOT EXISTS status_certainty    TEXT;   -- unknown | confirmed (NULL for rows created before this migration)
ALTER TABLE applications ADD COLUMN IF NOT EXISTS import_key          TEXT;   -- normalized company|role (or url) used to refuse duplicate imports
CREATE UNIQUE INDEX IF NOT EXISTS applications_import_key_uq ON applications (user_id, import_key) WHERE import_key IS NOT NULL;

-- Staging area for the review-and-confirm flow. Nothing here is an application until the user confirms it.
CREATE TABLE IF NOT EXISTS application_import_candidates (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch           TEXT NOT NULL,
  company         TEXT NOT NULL,
  role            TEXT,
  contact_email   TEXT,
  job_url         TEXT,
  region          TEXT NOT NULL DEFAULT 'unspecified',   -- india | international | unspecified
  source          TEXT NOT NULL DEFAULT 'historical_summary',
  verification    TEXT NOT NULL DEFAULT 'unverified' CHECK (verification IN ('unverified', 'verified', 'stale')),
  dedupe_key      TEXT NOT NULL,
  match_kind      TEXT NOT NULL DEFAULT 'new' CHECK (match_kind IN ('new', 'duplicate', 'possible_duplicate')),
  match_application_id INT REFERENCES applications(id) ON DELETE SET NULL,
  state           TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'confirmed', 'skipped', 'merged')),
  application_id  INT REFERENCES applications(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Staging the same record twice while it is still pending is refused.
CREATE UNIQUE INDEX IF NOT EXISTS application_import_pending_uq ON application_import_candidates (user_id, dedupe_key) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS application_import_user_idx ON application_import_candidates (user_id, state, id);

-- Audit trail for sensitive application actions (import confirm, merge, delete). Never credentials or message bodies.
CREATE TABLE IF NOT EXISTS application_audit (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  application_id INT,
  detail     TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Follow-up reminders (Atlas "Reminders" tab) ----------
-- In-app reminders only: nothing is emailed or pushed automatically. due_at is an absolute instant; timezone is kept for display.
CREATE TABLE IF NOT EXISTS career_reminders (
  id             SERIAL PRIMARY KEY,
  user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INT REFERENCES applications(id) ON DELETE SET NULL,
  draft_id       INT REFERENCES email_drafts(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  due_at         TIMESTAMPTZ NOT NULL,
  timezone       TEXT NOT NULL DEFAULT 'UTC',
  done_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS career_reminders_user_idx ON career_reminders (user_id, done_at, due_at);

-- ---------- Sign in with Google (additive) ----------
-- google_sub is Google's stable account id; email is only ever taken from a verified ID token. Anonymous users keep working (both NULL).
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_uq ON users (google_sub) WHERE google_sub IS NOT NULL;

-- ---------- Applications as the single record (additive) ----------
-- A user-recorded result. Only the user sets these; nothing infers an outcome from silence or from a sent message.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS outcome      TEXT;        -- replied | no_response | interview_scheduled | rejected | offer | accepted | declined | withdrawn
ALTER TABLE applications ADD COLUMN IF NOT EXISTS outcome_note TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS outcome_at   TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS email_drafts_application_idx ON email_drafts (application_id);

-- ============================================================================
-- Voice interview sessions (Career tools). Every table is scoped by user_id; every query filters on it.
-- Only ACCEPTED turns are stored. Draft transcripts and discarded recordings never reach these tables.
-- Provider configuration is stored by id only (never a key). Audio is stored only after explicit consent, with an expiry.
-- ============================================================================
CREATE TABLE IF NOT EXISTS voice_sessions (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL CHECK (mode IN ('technical','project_deep_dive','behavioral','spoken_english')),
  difficulty      TEXT NOT NULL DEFAULT 'medium',
  role            TEXT NOT NULL DEFAULT '',
  topics          TEXT[] NOT NULL DEFAULT '{}',
  seed_instruction TEXT NOT NULL DEFAULT '',
  job_description TEXT NOT NULL DEFAULT '',
  provider_config JSONB NOT NULL DEFAULT '{}',          -- {stt, tts, llm}: ids only
  input_mode      TEXT NOT NULL DEFAULT 'voice',        -- voice | text
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  max_turns       INT NOT NULL,
  max_minutes     INT NOT NULL,
  retain_audio    BOOLEAN NOT NULL DEFAULT false,       -- consent given when the session started
  busy_until      TIMESTAMPTZ,                          -- one model call in flight per session
  evaluation      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS voice_sessions_user_idx ON voice_sessions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_turns (
  id          SERIAL PRIMARY KEY,
  session_id  INT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idx         INT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('interviewer','candidate')),
  text        TEXT NOT NULL,
  stt         JSONB,                                     -- provider, language, segments with timestamps, confidence (when supplied), edited flag
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, idx)
);

CREATE TABLE IF NOT EXISTS voice_recordings (
  id          SERIAL PRIMARY KEY,
  session_id  INT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  turn_id     INT REFERENCES voice_turns(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime        TEXT NOT NULL,
  size_bytes  INT NOT NULL,
  audio       BYTEA NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_recordings_session_idx ON voice_recordings (session_id);
CREATE INDEX IF NOT EXISTS voice_recordings_expiry_idx ON voice_recordings (expires_at);

-- Jobs quality: last verification vs last seen. A failed fetch marks is_stale; it does not delete the row.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT false;

-- Company directory jobs (BLR Arena + public ATS). Independent of opening the Companies page.
CREATE TABLE IF NOT EXISTS company_profiles (
  slug                    TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  website                 TEXT,
  careers_url             TEXT,
  logo_url                TEXT,
  logo_source_domain      TEXT,
  logo_status             TEXT,
  logo_checked_at         TIMESTAMPTZ,
  last_jobs_fetch_at      TIMESTAMPTZ,
  last_jobs_success_at    TIMESTAMPTZ,
  last_jobs_error         TEXT,
  last_jobs_error_category TEXT,
  last_http_status        INT,
  jobs_stale              BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS company_jobs (
  id                         SERIAL PRIMARY KEY,
  company_slug               TEXT NOT NULL REFERENCES company_profiles(slug) ON DELETE CASCADE,
  external_job_id            TEXT,
  title                      TEXT NOT NULL,
  normalized_title           TEXT,
  seniority                  TEXT,
  work_mode                  TEXT,
  employment_type            TEXT,
  location                   TEXT,
  application_url            TEXT,
  canonical_application_url  TEXT,
  job_detail_url             TEXT,
  posted_at                  TIMESTAMPTZ,
  fresher_friendly           BOOLEAN,
  experience_min             NUMERIC,
  experience_max             NUMERIC,
  salary_min                 NUMERIC,
  salary_max                 NUMERIC,
  salary_estimated           BOOLEAN,
  description                TEXT,
  role_family                TEXT,
  source                     TEXT NOT NULL,
  first_seen_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at           TIMESTAMPTZ,
  is_stale                   BOOLEAN NOT NULL DEFAULT false,
  is_active                  BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS company_jobs_ext_uq ON company_jobs (company_slug, source, external_job_id) WHERE external_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS company_jobs_slug_idx ON company_jobs (company_slug);

CREATE TABLE IF NOT EXISTS company_job_sync_runs (
  id           SERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ DEFAULT now(),
  stats        JSONB NOT NULL DEFAULT '{}'
);

-- Application-URL columns: add them if an older company_jobs table predates them.
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS application_url TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS canonical_application_url TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS job_detail_url TEXT;

-- Which city a board-synced company belongs to (null for the Bengaluru snapshot companies).
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS city TEXT;


-- ============================================================================
-- Interview sessions (text/voice practice). Transcripts and scores only: audio is never stored.
-- Every row is scoped by user_id and every query filters on it.
-- ============================================================================
CREATE TABLE IF NOT EXISTS interview_sessions (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('practice','timed')),
  type        TEXT NOT NULL,
  level       TEXT NOT NULL,
  role        TEXT,
  startup_id  INT REFERENCES startups(id) ON DELETE SET NULL,
  questions   JSONB NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  report      JSONB
);
CREATE INDEX IF NOT EXISTS interview_sessions_user_idx ON interview_sessions (user_id, started_at DESC);
CREATE TABLE IF NOT EXISTS interview_answers (
  id          SERIAL PRIMARY KEY,
  session_id  INT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  question    TEXT NOT NULL,
  written     BOOLEAN NOT NULL DEFAULT false,
  attempt     INT NOT NULL DEFAULT 1,
  answer      TEXT NOT NULL,
  score       INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  feedback    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interview_answers_session_idx ON interview_answers (session_id, user_id);

-- Open-source contribution workspace: one row per (user, issue). Holds the saved flag, the 9-step progress and the cached AI guide.
CREATE TABLE IF NOT EXISTS oss_contributions (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo         TEXT NOT NULL,
  issue_number INT NOT NULL,
  issue_title  TEXT NOT NULL,
  issue_url    TEXT NOT NULL,
  saved        BOOLEAN NOT NULL DEFAULT false,
  done_steps   TEXT[] NOT NULL DEFAULT '{}',
  guide        JSONB,
  guide_at     TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, repo, issue_number)
);
CREATE INDEX IF NOT EXISTS oss_contributions_user_idx ON oss_contributions (user_id, updated_at DESC);
