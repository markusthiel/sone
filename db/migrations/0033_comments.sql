-- Comment threads, projected (ADR-0046).
--
-- The document is the truth; this is what can be queried. It answers the
-- questions no amount of opening documents answers well: every unresolved
-- thread in a workspace, how many a page carries, and which ones have lost the
-- text they were about.
--
-- Rebuildable and never authoritative, like every other projection here — the
-- materialiser replaces a page's rows wholesale rather than diffing them.
BEGIN;

CREATE TABLE IF NOT EXISTS page_comments (
  page_id       uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  -- The thread's id from the document. Not a serial: the document names it, and
  -- a second identity for one thing is a second thing to keep in step.
  thread_id     text NOT NULL,
  -- The words it was about, as they read when it was written. Kept here too so
  -- a workspace-wide list can show what a thread refers to without opening the
  -- page it is on.
  quote         text NOT NULL DEFAULT '',
  resolved      boolean NOT NULL DEFAULT false,
  -- Its text has been deleted. Unfinished business, and the one state somebody
  -- should be able to find deliberately.
  detached      boolean NOT NULL DEFAULT false,
  messages      integer NOT NULL DEFAULT 0,
  -- Who started it, for a list that says whose question is waiting. A user id,
  -- or a 'guest:' key (ADR-0022) — text rather than a reference to users,
  -- because a guest has no row there and a member who leaves still asked.
  opened_by     text,
  created_at    timestamptz,
  last_message_at timestamptz,
  PRIMARY KEY (page_id, thread_id)
);

-- The list this table exists for: what is still open, per workspace. The join
-- to pages carries the workspace, so the index is on what filters first.
CREATE INDEX IF NOT EXISTS page_comments_open_idx
  ON page_comments (page_id) WHERE NOT resolved;

INSERT INTO schema_migrations (version) VALUES ('0033_comments')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
