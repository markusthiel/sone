-- SONE 0063 — say when somebody's inbox changed (ADR-0093).
--
-- The bell counted the list the inbox already held and refreshed it when the
-- window regained focus (ADR-0092). That covers coming back to a tab and leaves
-- the case somebody actually watches: sitting on a page while a colleague names
-- you, and seeing nothing.
--
-- The same mechanism as `notify_doc_update` in 0001, for the same reason: one
-- process fewer than every comparable project ships with (ADR-0005). And the
-- same discipline about the payload — an id, never content. A notification's
-- excerpt is somebody's sentence, and a NOTIFY payload goes to every listening
-- instance regardless of who is connected to it. The listener asks the inbox
-- route, which is the one place that decides what this person may see.
--
-- **Statement-level, over a transition table.** A projection can write a
-- mention for the same person in several blocks at once, and a row-level
-- trigger would turn one edit into several refetches of one list. The
-- transition table also gives the property that matters in the other
-- direction: the projection runs its "delete notifications whose thread has
-- gone" sweep on every rewrite of a page, and a sweep that matched nothing
-- leaves the table empty, so nothing is sent.
--
-- Transactional, which is the point of doing it in the database rather than in
-- the server after the write: a notification produced inside a projection that
-- then rolls back is never announced. The last round's worst fault was a
-- projection that rolled back for ever without saying so (ADR-0092), and an
-- announcement it had already made would have been a badge for a row that does
-- not exist.
BEGIN;

CREATE OR REPLACE FUNCTION notify_inbox_changed() RETURNS trigger AS $$
DECLARE
  person uuid;
BEGIN
  -- Every trigger below names its transition table `changed`, so one function
  -- serves all three. `user_id` never moves between people, so the new rows
  -- name the right person for an update as well as for an insert.
  FOR person IN SELECT DISTINCT user_id FROM changed
  LOOP
    PERFORM pg_notify('sone_inbox_changed', json_build_object('userId', person)::text);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_notify_insert ON notifications;
CREATE TRIGGER notifications_notify_insert
  AFTER INSERT ON notifications
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_inbox_changed();

-- The count moves down as well as up: a thread deleted takes its notifications
-- with it (ADR-0092), and a badge that only ever counts up is a badge that lies
-- in the direction people notice least.
DROP TRIGGER IF EXISTS notifications_notify_delete ON notifications;
CREATE TRIGGER notifications_notify_delete
  AFTER DELETE ON notifications
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_inbox_changed();

-- Read and put-aside, and nothing else.
--
-- This is the case where the two screens belong to one person: marking
-- something read on a phone should move the badge on the desk. The device that
-- did it refetches too, which costs one request and keeps a single rule.
--
-- Its own function, comparing the rows before and after, because `AFTER UPDATE
-- OF read_at, snoozed_until` is not available here — Postgres refuses a column
-- list on a trigger with transition tables, and the statement-level dedupe is
-- worth more than the shorter spelling. Comparing is the better check anyway:
-- the mail job stamps `emailed_at` on rows it has sent, and an update that
-- leaves both of these columns alone changed nothing anybody is looking at.
CREATE OR REPLACE FUNCTION notify_inbox_read_changed() RETURNS trigger AS $$
DECLARE
  person uuid;
BEGIN
  FOR person IN
    SELECT DISTINCT after.user_id
      FROM changed AS after
      JOIN before ON before.id = after.id
     WHERE after.read_at IS DISTINCT FROM before.read_at
        OR after.snoozed_until IS DISTINCT FROM before.snoozed_until
  LOOP
    PERFORM pg_notify('sone_inbox_changed', json_build_object('userId', person)::text);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_notify_update ON notifications;
CREATE TRIGGER notifications_notify_update
  AFTER UPDATE ON notifications
  REFERENCING OLD TABLE AS before NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_inbox_read_changed();

INSERT INTO schema_migrations (version) VALUES ('0063_notify_inbox')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
