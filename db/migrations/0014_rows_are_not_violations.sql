-- SONE 0014 — a collection row inside a page is correct, not a violation.
--
-- `pages_inside_pages` reports entries whose parent is not a folder, because
-- until ADR-0021 that could only happen if a client wrote one directly or an
-- update arrived out of order.
--
-- Collection rows changed that. A row is a document that lives inside the page
-- holding the collection — that is the model, and it is what makes ancestry,
-- permissions and sharing work without a second mechanism. So every row was
-- reported as a violation, and the maintenance job logged the count every five
-- minutes.
--
-- Left as noise, a check that reports correct data teaches people to ignore it,
-- and the next real violation goes unnoticed among the false ones. The point of
-- this view is that it should be empty.

BEGIN;

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
    -- A row belongs inside a page by design (ADR-0021).
    AND child.kind <> 'row'
    AND child.archived_at IS NULL
    AND parent.archived_at IS NULL;

COMMENT ON VIEW pages_inside_pages IS
  'Entries whose parent is a page rather than a folder, excluding collection '
  'rows, which belong there by design (ADR-0021). Should be empty: the API '
  'refuses to create these, so a row here means a client wrote one directly or '
  'an update arrived out of order and has not settled yet.';

INSERT INTO schema_migrations (version) VALUES ('0014_rows_are_not_violations')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
