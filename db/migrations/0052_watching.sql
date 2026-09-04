-- Watching a page, and the scope it gives the digest (ADR-0064).
--
-- Its own table rather than a column on favourites: a favourite is "I come here
-- often" and watching is "tell me when this changes", and conflating them means
-- somebody who bookmarked a page for navigation starts getting mail about it.
--
-- Watching a folder watches what is under it, which is not recorded here — the
-- digest query expands it through ancestor_ids, the same way the in: search
-- filter does. Recording the descendants instead would mean a set that goes
-- stale the moment somebody moves a page.
--
-- digest_scope defaults to 'all', which is what the digest does today: a
-- release that silently narrows what somebody receives is as bad as one that
-- widens it.
BEGIN;

CREATE TABLE IF NOT EXISTS watched_pages (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  page_id    uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page_id)
);

CREATE INDEX IF NOT EXISTS watched_pages_page_idx ON watched_pages (page_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS digest_scope text NOT NULL DEFAULT 'all'
    CHECK (digest_scope IN ('all', 'watched'));

INSERT INTO schema_migrations (version) VALUES ('0052_watching')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
