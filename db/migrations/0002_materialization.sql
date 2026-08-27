-- SONE 0002_materialization
--
-- Two things 0001 was missing, both discovered while writing the
-- materialiser.
--
-- 1. Bookkeeping. The materialiser must know which CRDT sequence each page's
--    projection reflects, so that a crash mid-run is detectable and a
--    rebuild can be resumed rather than restarted.
--
-- 2. Sibling ordering must be (idx, id), never idx alone. The midpoint
--    algorithm is deterministic, so two clients inserting into the same gap
--    while offline generate the identical key. Both blocks survive the merge
--    and their order becomes a tie; without the id as tie-breaker two
--    clients render the same document in different orders. The indexes below
--    match that ORDER BY so the sort is index-only.

BEGIN;

-- ---------------------------------------------------------------------------
-- Materialisation state
-- ---------------------------------------------------------------------------

CREATE TYPE materialization_status AS ENUM ('ok', 'stale', 'failed');

CREATE TABLE materialization_state (
  page_id      uuid PRIMARY KEY REFERENCES pages (id) ON DELETE CASCADE,
  -- Highest doc_updates.seq reflected in the projection.
  through_seq  bigint NOT NULL DEFAULT 0,
  status       materialization_status NOT NULL DEFAULT 'ok',
  -- Populated when status = 'failed'. Kept so a bad block type does not
  -- silently drop a page out of every view.
  last_error   text,
  attempts     integer NOT NULL DEFAULT 0,
  materialized_at timestamptz NOT NULL DEFAULT now()
);

-- The rebuild worker's queue: anything not 'ok', oldest first.
CREATE INDEX materialization_state_pending_idx
  ON materialization_state (materialized_at)
  WHERE status <> 'ok';

-- ---------------------------------------------------------------------------
-- Sibling ordering
-- ---------------------------------------------------------------------------

DROP INDEX blocks_parent_idx;
CREATE INDEX blocks_parent_order_idx ON blocks (parent_id, idx, id);

DROP INDEX pages_parent_idx;
CREATE INDEX pages_parent_order_idx ON pages (parent_page_id, idx, id);

CREATE INDEX collection_fields_order_idx
  ON collection_fields (collection_id, idx, id);
CREATE INDEX collection_views_order_idx
  ON collection_views (collection_id, idx, id);

DROP INDEX collection_fields_collection_idx;
DROP INDEX collection_views_collection_idx;

-- ---------------------------------------------------------------------------
-- Collection row ordering
-- ---------------------------------------------------------------------------

-- Rows of a collection are ordered by their own idx within the collection,
-- independently of the page tree.
CREATE INDEX pages_collection_order_idx
  ON pages (collection_id, idx, id)
  WHERE collection_id IS NOT NULL;

DROP INDEX pages_collection_idx;

-- ---------------------------------------------------------------------------
-- Relation ordering
-- ---------------------------------------------------------------------------

-- Relation targets are user-ordered, so the forward lookup must be able to
-- return them in order without a sort.
CREATE INDEX page_relations_forward_order_idx
  ON page_relations (from_page_id, field_id, idx, to_page_id);

INSERT INTO schema_migrations (version) VALUES ('0002_materialization');

COMMIT;
