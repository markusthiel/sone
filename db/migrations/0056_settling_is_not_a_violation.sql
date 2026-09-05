-- The "entries inside pages" check gets the grace period it always claimed.
--
-- `pages_inside_pages` reports entries whose parent is not a folder. The
-- maintenance job's comment beside it says the count is "given a grace period
-- for the same reason as orphans: CRDT updates arrive in any order, so a
-- violation that is minutes old is probably still resolving."
--
-- The query underneath had no such condition. `SELECT count(*) FROM
-- pages_inside_pages`, every five minutes, counting rows that were about to
-- correct themselves — while the orphan check three lines above it does have
-- the hour.
--
-- Migration 0014 is about exactly this view reporting correct data as a
-- violation, and what that costs: "a check that reports correct data teaches
-- people to ignore it, and the next real violation goes unnoticed among the
-- false ones." Same view, same lesson, a different way in (ADR-0080).
--
-- The column is appended rather than inserted, because CREATE OR REPLACE VIEW
-- may add columns at the end and nowhere else.

BEGIN;

CREATE OR REPLACE VIEW pages_inside_pages AS
  SELECT
    child.id            AS child_id,
    child.kind          AS child_kind,
    child.title         AS child_title,
    parent.id           AS parent_id,
    parent.title        AS parent_title,
    child.workspace_id,
    -- What the grace period is measured from.
    child.created_at    AS created_at
  FROM pages child
  JOIN pages parent ON parent.id = child.parent_page_id
  WHERE parent.kind <> 'folder'
    -- A row belongs inside a page by design (ADR-0021), and so does a
    -- container (ADR-0026). Reporting them would mean this view logs a
    -- violation every time somebody protects a section.
    AND child.kind NOT IN ('row', 'container');

COMMENT ON VIEW pages_inside_pages IS
  'Entries whose parent is not a folder. Should be empty; rows and containers '
  'are excluded because they belong inside a page by design. Carries created_at '
  'so a caller can ignore what has not settled yet.';

INSERT INTO schema_migrations (version) VALUES ('0056_settling_is_not_a_violation')
  ON CONFLICT DO NOTHING;

COMMIT;
