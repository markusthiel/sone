-- SONE 0062 — finding a page's notifications (ADR-0092).
--
-- The projection now removes a notification whose thread has been deleted, and
-- it asks that question per page on every rewrite. The existing indexes are
-- `(user_id, created_at)` and the unread partial one — neither helps a lookup
-- by page, so the sweep was a scan of the whole table on every keystroke that
-- triggered a flush.
--
-- Also the index a hard delete of a page wants: `page_id` carries
-- `ON DELETE CASCADE`, and Postgres does not index a foreign key for you.
BEGIN;

CREATE INDEX IF NOT EXISTS notifications_page_idx
  ON notifications (page_id);

INSERT INTO schema_migrations (version) VALUES ('0062_notifications_by_page')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
