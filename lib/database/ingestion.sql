-- Automated job ingestion (additive and idempotent: only CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- Applied by ready() after schema.sql, or explicitly with `npm run db:migrate`.
-- Recovery / rollback: see docs/INGESTION.md ("Rollback"). Nothing here drops or rewrites existing data.
-- Reuse map:  companies → company_profiles   jobs → company_jobs   (existing tables, extended below)

ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS official_domain  TEXT;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS industry         TEXT;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS company_type     TEXT;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS funding_status   TEXT;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS description      TEXT;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();

-- Physical offices: a separate dataset from where a given job is located.
CREATE TABLE IF NOT EXISTS company_locations (
  id            BIGSERIAL PRIMARY KEY,
  company_slug  TEXT NOT NULL REFERENCES company_profiles(slug) ON DELETE CASCADE,
  city          TEXT NOT NULL,
  locality      TEXT,
  address       TEXT,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  is_approximate BOOLEAN NOT NULL DEFAULT true,
  source        TEXT,
  source_url    TEXT,
  licence       TEXT,
  verified_at   TIMESTAMPTZ,
  retrieved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS company_locations_uq ON company_locations (company_slug, city, COALESCE(locality, ''), COALESCE(address, ''));
CREATE INDEX IF NOT EXISTS company_locations_city_idx ON company_locations (city);

CREATE TABLE IF NOT EXISTS job_sources (
  id                    BIGSERIAL PRIMARY KEY,
  company_slug          TEXT NOT NULL REFERENCES company_profiles(slug) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  board_slug            TEXT,
  tenant                TEXT,
  host                  TEXT,
  career_site           TEXT,
  source_url            TEXT,
  config                JSONB NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','failing','needs_review')),
  priority              TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high','normal')),
  poll_interval_minutes INT  NOT NULL DEFAULT 60 CHECK (poll_interval_minutes >= 5),
  last_checked_at       TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  next_check_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  consecutive_failures  INT  NOT NULL DEFAULT 0,
  consecutive_rate_limits INT NOT NULL DEFAULT 0,
  last_error            TEXT,
  last_error_category   TEXT,
  last_http_status      INT,
  etag                  TEXT,
  last_modified         TEXT,
  locked_until          TIMESTAMPTZ,          -- lease: a crashed worker's claim expires by itself
  license_class         TEXT NOT NULL DEFAULT 'employer_public',
  attribution           TEXT,
  validation            JSONB,                -- evidence from the validating fetch (counts + 3 sample titles)
  last_sample           JSONB,                -- last fetch outcome for the admin "inspect response" view (no headers/secrets)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_sources_identity_uq ON job_sources (provider, COALESCE(board_slug,''), COALESCE(tenant,''), COALESCE(host,''), COALESCE(career_site,''));
CREATE INDEX IF NOT EXISTS job_sources_due_idx ON job_sources (next_check_at) WHERE status IN ('active','failing');
CREATE INDEX IF NOT EXISTS job_sources_company_idx ON job_sources (company_slug);

-- company_jobs is the jobs table. New columns only; legacy rows keep working (source_id NULL).
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS source_id        BIGINT REFERENCES job_sources(id) ON DELETE SET NULL;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS provider         TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS content_hash     TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'active';
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS closed_at        TIMESTAMPTZ;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS reopened_count   INT NOT NULL DEFAULT 0;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS locations        TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS city_class       TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS remote_india     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS workplace_type   TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS source_url       TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS salary_currency  TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS salary_period    TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS posted_at_approx BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS license_class    TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS attribution      TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();
DO $$ BEGIN
  ALTER TABLE company_jobs ADD CONSTRAINT company_jobs_status_chk CHECK (status IN ('active','closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The identity of an ingested job: one row per (source, external id). Idempotent upserts rely on this.
CREATE UNIQUE INDEX IF NOT EXISTS company_jobs_source_ext_uq ON company_jobs (source_id, external_job_id) WHERE source_id IS NOT NULL AND external_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS company_jobs_city_idx    ON company_jobs (city_class, posted_at DESC) WHERE is_active;
CREATE INDEX IF NOT EXISTS company_jobs_remote_idx  ON company_jobs (posted_at DESC) WHERE is_active AND remote_india;
CREATE INDEX IF NOT EXISTS company_jobs_first_seen_idx ON company_jobs (first_seen_at DESC) WHERE is_active;
CREATE INDEX IF NOT EXISTS company_jobs_source_idx  ON company_jobs (source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS company_jobs_missing_apply_idx ON company_jobs (company_slug) WHERE is_active AND application_url IS NULL;

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id              BIGSERIAL PRIMARY KEY,
  source_id       BIGINT NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','not_modified','partial','failed','cancelled')),
  http_status     INT,
  jobs_fetched    INT NOT NULL DEFAULT 0,
  jobs_inserted   INT NOT NULL DEFAULT 0,
  jobs_updated    INT NOT NULL DEFAULT 0,
  jobs_closed     INT NOT NULL DEFAULT 0,
  jobs_unchanged  INT NOT NULL DEFAULT 0,
  jobs_reopened   INT NOT NULL DEFAULT 0,
  jobs_missing_apply_url INT NOT NULL DEFAULT 0,
  error_category  TEXT,
  error_message   TEXT,
  duration_ms     INT
);
CREATE INDEX IF NOT EXISTS ingestion_runs_source_idx ON ingestion_runs (source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ingestion_runs_recent_idx ON ingestion_runs (started_at DESC);

-- Discovery queue: every candidate company moves through explicit states; nothing becomes a source without validation.
CREATE TABLE IF NOT EXISTS discovery_candidates (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  website_url     TEXT,
  official_domain TEXT,
  careers_url     TEXT,
  provider        TEXT,
  board_slug      TEXT,
  tenant          TEXT,
  host            TEXT,
  career_site     TEXT,
  origin          TEXT NOT NULL,                 -- registry:<name> | admin | funding | directory:<name> | ...
  origin_ref      TEXT,
  state           TEXT NOT NULL DEFAULT 'candidate_discovered' CHECK (state IN
                  ('candidate_discovered','website_identified','career_page_identified','ats_detected','board_validated','active_source','failed_source','needs_manual_review')),
  evidence        JSONB NOT NULL DEFAULT '{}',
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  company_slug    TEXT REFERENCES company_profiles(slug) ON DELETE SET NULL,
  source_id       BIGINT REFERENCES job_sources(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS discovery_candidates_board_uq ON discovery_candidates (provider, COALESCE(board_slug,''), COALESCE(tenant,''), COALESCE(host,''), COALESCE(career_site,'')) WHERE provider IS NOT NULL;
CREATE INDEX IF NOT EXISTS discovery_candidates_queue_idx ON discovery_candidates (state, next_attempt_at);
CREATE INDEX IF NOT EXISTS discovery_candidates_name_idx ON discovery_candidates (normalized_name);

CREATE TABLE IF NOT EXISTS source_discovery_runs (
  id            BIGSERIAL PRIMARY KEY,
  method        TEXT NOT NULL,                  -- registry_import | validate_queue | url_detect | cdx | admin ...
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'running',
  candidates_seen      INT NOT NULL DEFAULT 0,
  candidates_new       INT NOT NULL DEFAULT 0,
  validated            INT NOT NULL DEFAULT 0,
  activated            INT NOT NULL DEFAULT 0,
  rejected_not_india   INT NOT NULL DEFAULT 0,
  failed               INT NOT NULL DEFAULT 0,
  error_message TEXT,
  details       JSONB NOT NULL DEFAULT '{}'
);
-- Incremental discovery state (cursors, last-run markers) so nothing re-scans history.
CREATE TABLE IF NOT EXISTS discovery_state (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Funding signals are evidence about a company, kept apart from job openings. They never create a job.
CREATE TABLE IF NOT EXISTS company_funding_signals (
  id            BIGSERIAL PRIMARY KEY,
  company_slug  TEXT NOT NULL REFERENCES company_profiles(slug) ON DELETE CASCADE,
  announced_on  DATE,
  amount_text   TEXT,
  round         TEXT,
  evidence_url  TEXT NOT NULL,
  source        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_slug, evidence_url)
);

-- ── City coverage + board-validation records (Bengaluru / Hyderabad / Chennai data supply chain) ─────────────────────────
-- Every tracked city a job is really located in (from the job's own locations). city_class stays as the one-bucket summary.
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS cities TEXT[] NOT NULL DEFAULT '{}';
UPDATE company_jobs SET cities = CASE city_class WHEN 'bengaluru' THEN ARRAY['bengaluru'] WHEN 'hyderabad' THEN ARRAY['hyderabad'] WHEN 'both' THEN ARRAY['bengaluru','hyderabad'] ELSE '{}' END
  WHERE cities = '{}' AND city_class IN ('bengaluru','hyderabad','both');
CREATE INDEX IF NOT EXISTS company_jobs_cities_idx ON company_jobs USING GIN (cities) WHERE is_active;
-- Result of the last live check of the employer's application link (HEAD/GET). Never changes application_url itself.
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS apply_url_status     TEXT;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS apply_url_checked_at TIMESTAMPTZ;
ALTER TABLE company_jobs ADD COLUMN IF NOT EXISTS apply_url_http       INT;

-- Discovery order: ATS platforms that are India-native are validated first. Higher = earlier.
ALTER TABLE discovery_candidates ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS discovery_candidates_priority_idx ON discovery_candidates (priority DESC, next_attempt_at);

-- One row per validation attempt of a candidate board against its real ATS endpoint. Company discovery and job discovery stay
-- separate: this table says whether the BOARD is real and what it published at that moment, not whether a job is open today.
CREATE TABLE IF NOT EXISTS source_validations (
  id            BIGSERIAL PRIMARY KEY,
  candidate_id  BIGINT REFERENCES discovery_candidates(id) ON DELETE CASCADE,
  source_id     BIGINT REFERENCES job_sources(id) ON DELETE SET NULL,
  provider      TEXT NOT NULL,
  board_ref     TEXT NOT NULL,                       -- human-readable identity (slug or tenant/host/site)
  status        TEXT NOT NULL CHECK (status IN ('valid_with_jobs','valid_no_jobs','not_found','unsupported_provider','access_restricted','temporarily_unavailable','invalid_response')),
  http_status   INT,
  jobs_seen     INT,
  complete      BOOLEAN,
  india_jobs    INT,                                 -- jobs whose own location is in India (any city or India-remote)
  city_counts   JSONB NOT NULL DEFAULT '{}',        -- {bengaluru, hyderabad, chennai, india_remote, other_india, unknown, ...}
  error         TEXT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS source_validations_candidate_idx ON source_validations (candidate_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS source_validations_status_idx ON source_validations (status, checked_at DESC);
ALTER TABLE job_sources ALTER COLUMN poll_interval_minutes SET DEFAULT 60;

-- Duplicate job records dropped from a source's own payload (same external id listed twice). Reported, never silently ignored.
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS jobs_duplicates INT NOT NULL DEFAULT 0;
