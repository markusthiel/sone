-- Putting a notification aside until a time (ADR-0075).
--
-- A column rather than a table: it is one fact about one notification, and a
-- row that exists only while something is asleep would need to be created,
-- found and deleted for a value that is null the rest of the time.
--
-- Nothing wakes it. A notification is asleep while `snoozed_until` is in the
-- future, so it returns on its own when the clock passes it — there is no job
-- to run, nothing to miss a tick, and no state to be out of step with the time.
-- That is the whole reason the column holds a moment rather than a flag.
--
-- Null means awake, which is what every row that exists today means.
BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

-- The count and the unread listing both ask "is this awake", and both are read
-- on every page load. Partial, because the rows that are asleep are the few.
CREATE INDEX IF NOT EXISTS notifications_snoozed_idx
  ON notifications (user_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('0055_snooze')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
