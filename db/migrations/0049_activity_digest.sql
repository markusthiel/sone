-- A mail about what changed, as opposed to what was addressed to you
-- (ADR-0062).
--
-- Opt-in, so the default is 'off' and nobody's mail changes when this ships: a
-- notification is aimed at somebody and its mail is expected, while activity is
-- aimed at nobody and an unasked-for list of what colleagues did is what people
-- mean when they call something spam.
--
-- The watermark is what stops a digest repeating itself. Null means "never sent
-- one", and the first digest then covers the period the schedule implies rather
-- than everything since the beginning of the workspace.
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS activity_digest text NOT NULL DEFAULT 'off'
    CHECK (activity_digest IN ('off', 'daily', 'weekly')),
  ADD COLUMN IF NOT EXISTS activity_digest_sent_at timestamptz;

INSERT INTO schema_migrations (version) VALUES ('0049_activity_digest')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
