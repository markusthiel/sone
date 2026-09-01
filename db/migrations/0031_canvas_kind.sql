-- A canvas is a kind of entry (ADR-0043).
--
-- The check constraint on `pages.kind` listed the four kinds that existed when
-- it was written, so creating a canvas failed at the last step with nothing but
-- "something went wrong" — the interface offering a thing the schema refuses.
--
-- The constraint is worth keeping rather than dropping: it is what catches a
-- typo'd kind before it reaches a tree that then cannot draw it. The cost is
-- exactly this, a migration per kind, and that is the right price.
BEGIN;

ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_kind_check;

ALTER TABLE pages
  ADD CONSTRAINT pages_kind_check
    CHECK (kind IN ('page', 'folder', 'row', 'container', 'canvas'));

COMMENT ON COLUMN pages.kind IS
  'What this entry is. Folders organise, pages hold writing, canvases hold '
  'things placed freely on a plane, rows belong to a collection, and containers '
  'are protected sections embedded in a page. Rows and containers are documents '
  'rather than places and are not shown in the tree.';

COMMIT;
