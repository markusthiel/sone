-- Work that outlives a request (ADR-0044).
--
-- A workspace export cannot be an HTTP response: it reads every page, packs
-- megabytes, and takes longer than any sensible timeout. So it becomes a row,
-- something picks it up, and the result is fetched later.
--
-- Deliberately a table and not a queue service. SONE deploys as one container
-- plus Postgres (ADR-0004), and `FOR UPDATE SKIP LOCKED` is a work queue that
-- several instances can share correctly — which is the only property a queue
-- service would add here.
BEGIN;

CREATE TABLE IF NOT EXISTS jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind         text NOT NULL,
  state        text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'done', 'failed')),
  -- What to do, in the shape the job's own handler expects.
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- What came of it: a storage key for an export, counts for an import.
  result       jsonb,
  -- Something a person can read while they wait. Not a percentage: a job that
  -- does not know how much is left cannot honestly report a fraction, and a bar
  -- that stalls at 90% is worse than a sentence saying what is happening.
  progress     text,
  error        text,
  -- Who asked. A job hands back somebody's workspace contents, so the download
  -- has to check that it is the same person.
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  -- When the result stops being available. An export sitting in the file store
  -- for ever is a copy of a workspace nobody remembers making.
  expires_at   timestamptz,
  -- Bounded retries, so a job that fails on a malformed page does not run for
  -- ever. Left at zero: the first version does not retry at all, and the column
  -- exists so that adding it later is not a migration.
  attempts     integer NOT NULL DEFAULT 0
);

-- The claim query: the oldest queued job, locked, skipping what another
-- instance already holds.
CREATE INDEX IF NOT EXISTS jobs_queued_idx
  ON jobs (created_at) WHERE state = 'queued';

CREATE INDEX IF NOT EXISTS jobs_workspace_idx ON jobs (workspace_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('0035_jobs')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
