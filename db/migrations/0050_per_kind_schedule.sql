-- How often, per kind of notification (ADR-0061, amended).
--
-- The three booleans said whether a kind is worth a mail, and one column said
-- how often mail arrives. ADR-0061 refused to combine them, arguing that "two
-- schedules is a matrix" — but the design that was actually wanted is not a
-- matrix. It is one control per kind, replacing the tick: immediately, in the
-- daily mail, or never. Three controls where there were four.
--
-- Somebody who wants to be told at once when they are mentioned, and to read
-- the rest tomorrow, is asking for the ordinary thing.
--
-- Migrated from what each account already had, so nobody's mail changes: a kind
-- that was off stays 'off', and one that was on takes the account's existing
-- schedule.
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mentions_when text NOT NULL DEFAULT 'immediately'
    CHECK (mentions_when IN ('immediately', 'daily', 'off')),
  ADD COLUMN IF NOT EXISTS assignments_when text NOT NULL DEFAULT 'immediately'
    CHECK (assignments_when IN ('immediately', 'daily', 'off')),
  ADD COLUMN IF NOT EXISTS replies_when text NOT NULL DEFAULT 'off'
    CHECK (replies_when IN ('immediately', 'daily', 'off'));

UPDATE users SET
  mentions_when = CASE
    WHEN NOT email_mentions OR email_schedule = 'off' THEN 'off'
    WHEN email_schedule = 'daily' THEN 'daily'
    ELSE 'immediately' END,
  assignments_when = CASE
    WHEN NOT email_assignments OR email_schedule = 'off' THEN 'off'
    WHEN email_schedule = 'daily' THEN 'daily'
    ELSE 'immediately' END,
  replies_when = CASE
    WHEN NOT email_replies OR email_schedule = 'off' THEN 'off'
    WHEN email_schedule = 'daily' THEN 'daily'
    ELSE 'immediately' END;

-- The old columns stay for one release rather than being dropped here: a
-- rollback to 0.6.0 must not find them missing, and dropping a column is the
-- one migration that cannot be undone by running the next one.
COMMENT ON COLUMN users.email_mentions IS
  'Superseded by mentions_when (ADR-0061 amendment). Kept for one release so a
   rollback to 0.6.0 still works; drop after 0.7.0.';

INSERT INTO schema_migrations (version) VALUES ('0050_per_kind_schedule')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
