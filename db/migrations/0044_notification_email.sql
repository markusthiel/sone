-- When a notification's email went out, if it did (ADR-0058).
--
-- A column on `notifications` rather than a second table: the thing being
-- emailed and the thing being shown in the inbox are the same row, and two
-- tables would eventually disagree about whether something had been delivered.
--
-- Null means "not sent", which covers three different situations on purpose —
-- not yet, no relay configured, and the person does not want mail. None of them
-- needs distinguishing here: the sender decides afresh each time, and a column
-- recording *why* something was not sent would be a second place for that
-- decision to live.
BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz;

-- The sender's query: what is waiting, unread, and not yet mailed. Partial, so
-- it holds only the rows still to consider rather than every notification ever
-- written.
CREATE INDEX IF NOT EXISTS notifications_to_email_idx
  ON notifications (user_id, workspace_id, created_at)
  WHERE emailed_at IS NULL AND read_at IS NULL;

-- Whether somebody wants mail at all, per kind (ADR-0058).
--
-- Defaults: on for mentions and assignments, which somebody is expected to act
-- on, and off for replies to threads they are merely in — that is the kind that
-- arrives most often and asks least.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_mentions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_assignments boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_replies boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version) VALUES ('0044_notification_email')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
