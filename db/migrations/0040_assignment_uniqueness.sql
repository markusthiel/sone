-- An assignment notification is made once, which the previous constraint did
-- not achieve (ADR-0052).
--
-- 0039 declared UNIQUE (user_id, kind, thread_id, message_id) and relied on it
-- to make notifications idempotent under re-projection. That works for a
-- comment, which has a thread. An assignment has none, so thread_id is NULL —
-- and in Postgres two NULLs are distinct by default, so the constraint matched
-- nothing and every projection of the page would have written the row again.
-- A page is re-projected whenever anything in it changes, so somebody with one
-- assigned task would have collected a notification per edit.
--
-- NULLS NOT DISTINCT is the fix rather than an empty string in place of the
-- NULL: the column means "no thread", and saying that with a value that looks
-- like a thread id would push the lie one layer down.
--
-- Requires Postgres 15; SONE requires 17.
BEGIN;

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_user_id_kind_thread_id_message_id_key;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_once_per_thing
  UNIQUE NULLS NOT DISTINCT (user_id, kind, thread_id, message_id);

INSERT INTO schema_migrations (version) VALUES ('0040_assignment_uniqueness')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
