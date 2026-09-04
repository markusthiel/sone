-- The four mail columns 0050 superseded (ADR-0061 amendment).
--
-- 0050 kept them and said why: a rollback from 0.7.0 to 0.6.0 had to find them,
-- and dropping a column is the one migration that running the next one cannot
-- undo. 0.7.0 has shipped, so that window is closed — a rollback from here
-- reaches 0.7.0, which reads the per-kind columns and not these.
--
-- The comment on email_mentions said "drop after 0.7.0". This is that.
--
-- The allowance naming these four in the SQL column guard goes in the same
-- commit. An allowance nobody removes is how a guard becomes decoration.
BEGIN;

ALTER TABLE users
  DROP COLUMN IF EXISTS email_mentions,
  DROP COLUMN IF EXISTS email_assignments,
  DROP COLUMN IF EXISTS email_replies,
  DROP COLUMN IF EXISTS email_schedule;

INSERT INTO schema_migrations (version) VALUES ('0053_drop_old_mail_columns')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
