-- Comments a share link cannot read (ADR-0057).
--
-- Its own table rather than a flag on `page_comments`, and that is the decision:
-- the comment search and the inbox read the projected rows, so sharing one table
-- and filtering everywhere is how an internal thread reaches somebody who cannot
-- open it — the first time a new query is written by somebody who did not know
-- the flag existed. A separate table cannot leak that way, because a query has
-- to name it to see it.
--
-- The same shape as `page_comments`, deliberately: a row is a thread, not a
-- message. Mirroring it means the two can be compared and the projection code is
-- the same shape twice rather than two ideas — my first version of this table
-- invented a message-level schema, which would have made every future query
-- against it different from the one beside it.
BEGIN;

CREATE TABLE IF NOT EXISTS page_comments_internal (
  page_id       uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  thread_id     text NOT NULL,
  quote         text NOT NULL DEFAULT '',
  resolved      boolean NOT NULL DEFAULT false,
  detached      boolean NOT NULL DEFAULT false,
  messages      integer NOT NULL DEFAULT 0,
  opened_by     text,
  created_at    timestamptz,
  last_message_at timestamptz,
  PRIMARY KEY (page_id, thread_id)
);

-- Keyed by the page, which is how the panel asks. The derived document id is
-- not stored: it is computed from the page id, and storing it would be a second
-- copy to keep in step with a function.
CREATE INDEX IF NOT EXISTS page_comments_internal_open_idx
  ON page_comments_internal (page_id) WHERE NOT resolved;

INSERT INTO schema_migrations (version) VALUES ('0043_internal_comments')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
