-- Bounded retries for the job queue, which ADR-0058 said already existed.
--
-- The record: "Five attempts with widening gaps, then failed." What the runner
-- did was mark a job `failed` on the first exception. `attempts` was bumped at
-- claim time and read by nobody, and `retryDelayMs` in the maintenance job — a
-- function about a different queue entirely — had two tests and no callers.
--
-- The consequence was not cosmetic. Notification mail is claimed by setting
-- `emailed_at`, which is the only way back in, so one transient relay hiccup
-- discarded a batch of somebody's notifications permanently. The whole reason
-- `emailed_at` may mean "claimed" rather than "delivered" is that the queue
-- owns the retries — and it did not (ADR-0081).
--
-- 0035_jobs said adding retries would not need a migration. It was nearly
-- right: retrying does not, but retrying *after a delay* needs somewhere to put
-- the delay, and retrying without one just hammers a relay that is already
-- unhappy.

BEGIN;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS run_after timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN jobs.run_after IS
  'Not before this. Set into the future when a failed job is requeued, so the '
  'gap between attempts widens instead of the queue spinning.';

-- The claim query now filters on it, so the partial index has to as well —
-- otherwise every queued job is scanned to find the ones that are due.
DROP INDEX IF EXISTS jobs_queued_idx;
CREATE INDEX IF NOT EXISTS jobs_queued_idx
  ON jobs (run_after, created_at) WHERE state = 'queued';

INSERT INTO schema_migrations (version) VALUES ('0057_job_retries')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
