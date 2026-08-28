-- SONE 0013 — rows are a third kind of entry (ADR-0021).
--
-- A collection is a block in a page, not a folder, and its rows are documents
-- that do not appear in the tree. `kind` already separates 'page' from 'folder';
-- this adds 'row'.
--
-- The constraint is replaced rather than added: 0007 created
-- pages_kind_check with two values, so a third has to widen the existing one.
-- Dropped and recreated in one transaction, which is safe because nothing can
-- insert between the two statements.

BEGIN;

ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_kind_check;

ALTER TABLE pages
  ADD CONSTRAINT pages_kind_check CHECK (kind IN ('page', 'folder', 'row'));

COMMENT ON COLUMN pages.kind IS
  'What this entry is. Folders organise, pages hold writing, rows belong to a '
  'collection and are not shown in the tree (ADR-0019, ADR-0021).';

-- Rows of a collection, found by the collection they belong to. Every table
-- read asks exactly this question, and without the index it is a scan of the
-- workspace's pages.
CREATE INDEX IF NOT EXISTS pages_collection_rows_idx
  ON pages (collection_id, idx, id)
  WHERE kind = 'row' AND archived_at IS NULL;

-- The 0.2.0 folder shape, retired.
--
-- A folder that carried a collection becomes an ordinary folder again, and the
-- pages inside it stay ordinary pages exactly where they are. Nothing anybody
-- wrote is deleted: the columns and any values remain in the documents, unread.
--
-- Not converted, deliberately. Converting faithfully would mean inventing a
-- containing page for each table and rewriting every child's document to be a
-- row — a large amount of machinery for a shape that shipped in one release.
-- Anybody who has one keeps their pages and loses a table they made days ago.
--
-- This lands in the same change as the interface that replaces it. Removing it
-- earlier would have left a build offering "Add columns" on a folder with
-- nowhere to put the result: every migration has to leave a working instance
-- behind, not just a correct schema.

UPDATE pages SET collection_id = NULL
 WHERE kind = 'folder' AND collection_id IS NOT NULL;

DELETE FROM collections
 WHERE page_id IN (SELECT id FROM pages WHERE kind = 'folder');

INSERT INTO schema_migrations (version) VALUES ('0013_collection_rows')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
