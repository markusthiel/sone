-- Who caused a notification (ADR-0058).
--
-- Absent until now, which I found by writing the email job's query against a
-- column that did not exist. A notification said what happened, where, and to
-- whom — and not by whom, so "Anna mentioned you" was a sentence the data could
-- not produce.
--
-- Nullable, and it stays nullable: rows written before this have no actor and
-- inventing one would be worse than the sentence that omits it. `ON DELETE SET
-- NULL` for the same reason — a notification outliving the account that caused
-- it is normal, and the mail and the inbox both read a missing actor as "no
-- name to show".
BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS actor_id uuid REFERENCES users (id) ON DELETE SET NULL;

INSERT INTO schema_migrations (version) VALUES ('0045_notification_actor')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
