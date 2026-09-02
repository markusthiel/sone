-- When somebody has been addressed (ADR-0052).
--
-- Not an activity feed: a row exists here when a person was *addressed*, not
-- when something happened. A page anybody edits produces entries nobody reads,
-- and the one thing that mattered ends up on the third screen.
--
-- In Postgres rather than in the document, because a notification is about a
-- person and not about a page — and a read flag in a CRDT is a flag anybody can
-- flip for everybody.
BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who it is for. Their deletion takes it with them.
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id      uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('mention', 'reply', 'assignment')),
  -- Which conversation, and which message in it. Text rather than references:
  -- both are ids from inside a Yjs document, which Postgres does not own.
  thread_id    text,
  message_id   text,
  -- A few words, so the inbox can be read without opening every page. A copy,
  -- deliberately: the message may be edited or deleted afterwards, and what
  -- somebody was told at the time is what the inbox should still say.
  excerpt      text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Read means "opened the thing it points at", not "looked at the inbox": an
  -- inbox that empties itself when glanced at is one that loses things.
  read_at      timestamptz,
  -- Made once per message. A page is reprojected whenever anything in it
  -- changes, so without this the materialiser would create the same mention
  -- again on every edit.
  UNIQUE (user_id, kind, thread_id, message_id)
);

-- The count on the account button: one indexed count of this person's unread
-- rows, seen on every page.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_person_idx
  ON notifications (user_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('0039_notifications')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
