-- SONE 0008_favourites
--
-- A favourite is a person's, not a page's.
--
-- Deliberately *not* in the CRDT document, which is the opposite of the choice
-- made for folders in ADR-0019. The reasoning differs because the data does:
--
--   - A folder is a property of the workspace. Everyone sees the same tree, so
--     it belongs in the document and has to be rebuildable from the CRDT log.
--   - A favourite is a property of one person's relationship to a page. Putting
--     it in the document would mean every collaborator's shortcuts are stored
--     in, and synced with, a page they share — which is both a privacy leak
--     (what someone finds important is not the page's business) and an editing
--     conflict waiting to happen.
--
-- So this does not weaken ADR-0002's guarantee. The projection is still
-- derivable from the CRDTs; favourites are simply not part of the projection.
-- They are instance data, like sessions and invitations, and are backed up with
-- the database rather than reconstructed from documents.

BEGIN;

CREATE TABLE favourites (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  page_id    uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  -- Fractional index, so favourites can be reordered without renumbering and
  -- two clients reordering concurrently converge (ADR-0015). Compared
  -- byte-wise, which the C collation guarantees.
  idx        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page_id)
);

-- The list one person sees, in order. The only query this table serves often.
CREATE INDEX favourites_user_idx ON favourites (user_id, idx, page_id);

-- ON DELETE CASCADE on page_id is safe here in a way it is not for the page
-- tree: a favourite is derived state that should vanish with its page, and
-- unlike a CRDT update it can never arrive before the row it references. That
-- is why migration 0003 dropped the tree's foreign keys and this one keeps its.

COMMENT ON TABLE favourites IS
  'Per-person shortcuts to pages. Not part of the CRDT projection: a favourite '
  'belongs to a person rather than to a page, so it is instance data like a '
  'session rather than something rebuildable from a document.';

INSERT INTO schema_migrations (version) VALUES ('0008_favourites')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
