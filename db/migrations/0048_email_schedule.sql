-- How often somebody is emailed, as opposed to about what (ADR-0061).
--
-- Beside the three per-kind columns rather than replacing them: those say what
-- is worth a mail, this says how often. Two different questions, and folding
-- them into one enum would mean "mentions daily, replies never" could not be
-- said at all.
--
-- `batched` is what everybody has today — one mail per person per workspace a
-- few minutes after the fact — so the default preserves the current behaviour
-- and nobody's mail changes because of this migration.
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_schedule text NOT NULL DEFAULT 'batched'
    CHECK (email_schedule IN ('batched', 'daily', 'off'));

INSERT INTO schema_migrations (version) VALUES ('0048_email_schedule')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
