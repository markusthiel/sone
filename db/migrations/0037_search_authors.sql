-- Who has writing in a page, for narrowing a search by author (ADR-0050).
--
-- On page_search rather than on pages: it is there to be filtered by a search,
-- and the search already reads that table. A column on pages would be read by
-- the tree, the export and every page listing for the sake of one query.
--
-- Names rather than user ids, and that is the decision worth stating. The filter
-- is typed — `author:markus` — so it has to match what somebody would type.
--
-- The document holds ids, not names: `Y.PermanentUserData` is keyed by whatever
-- the client passed, which is a user id or a `guest:` key (ADR-0022). So a join
-- to users is needed either way — the choice is whether it happens once per
-- projection or once per row of every ranked search. Once, here. A guest's name
-- comes straight from the key, which no join could have resolved at all.
--
-- The cost is that a rename does not reach old rows until they are next
-- projected. Accepted: a search for a name somebody no longer uses finding their
-- older pages is closer to what was meant than finding nothing.
BEGIN;

ALTER TABLE page_search
  ADD COLUMN IF NOT EXISTS authors text[] NOT NULL DEFAULT '{}';

-- The filter is a prefix match against any element, which is a sequential scan
-- of the array per row — cheap for the handful of names a page has, and the rows
-- are already narrowed by workspace and by the text query before this applies.
CREATE INDEX IF NOT EXISTS page_search_authors_idx
  ON page_search USING gin (authors);

INSERT INTO schema_migrations (version) VALUES ('0037_search_authors')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
