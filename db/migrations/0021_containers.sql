-- SONE 0021 — a protected container is its own document (ADR-0026).
--
-- Permissions on part of a page cannot be enforced by hiding blocks: a client
-- receives the whole CRDT document because merging requires it, so a block the
-- interface declines to draw is still in the browser's memory. That is a
-- display convention, not access control, and it is worse than not having the
-- feature — somebody will put something private behind it.
--
-- So a protected container is a separate document, embedded by reference. The
-- server serves it to those allowed and to nobody else, which is the same
-- mechanism that protects a page and the only enforcement here that is real.
--
-- The shape is the one collection rows already use (ADR-0021): an entry that is
-- a real document and does not appear in the tree.

BEGIN;

ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_kind_check;

ALTER TABLE pages
  ADD CONSTRAINT pages_kind_check CHECK (kind IN ('page', 'folder', 'row', 'container'));

COMMENT ON COLUMN pages.kind IS
  'What this entry is. Folders organise, pages hold writing, rows belong to a '
  'collection, and containers are protected sections embedded in a page. Rows '
  'and containers are documents rather than places and are not shown in the '
  'tree (ADR-0019, ADR-0021, ADR-0026).';

-- A container inside a page is correct by design, exactly as a row is.
CREATE OR REPLACE VIEW pages_inside_pages AS
  SELECT
    child.id            AS child_id,
    child.kind          AS child_kind,
    child.title         AS child_title,
    parent.id           AS parent_id,
    parent.title        AS parent_title,
    child.workspace_id
  FROM pages child
  JOIN pages parent ON parent.id = child.parent_page_id
  WHERE parent.kind <> 'folder'
    -- A row belongs inside a page by design (ADR-0021), and so does a
    -- container (ADR-0026). Reporting them would mean this view logs a
    -- violation every time somebody protects a section.
    AND child.kind NOT IN ('row', 'container');

-- A container is restricted from the moment it exists.
--
-- The alternative is a window between creating one and setting its rules, in
-- which it is an ordinary part of the page — and the person creating it has
-- every reason to believe it is already private.
INSERT INTO schema_migrations (version) VALUES ('0021_containers')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
