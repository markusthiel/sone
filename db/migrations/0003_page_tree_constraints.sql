-- SONE 0003_page_tree_constraints
--
-- Two foreign keys from 0001 turned out to be wrong, both found by the first
-- integration tests. They are wrong for the same underlying reason, which is
-- worth stating clearly because it will come up again:
--
--   In a local-first system, documents arrive in an arbitrary order. A child
--   page can sync before its parent. A collection row can sync before the
--   collection definition. Referential integrity enforced at insert time
--   forbids a state the system legitimately passes through.
--
-- 1. pages.parent_page_id -> pages(id)
--    The materialiser deliberately handles "parent not materialised yet" by
--    recording a provisional ancestor path and letting the parent's own
--    projection cascade down. The FK made that impossible: the insert failed
--    outright.
--
-- 2. pages.collection_id -> collections(id)
--    Circular by construction — collections.page_id references pages(id) and
--    pages.collection_id references collections(id). A page that owns a
--    collection can satisfy neither order.
--
-- 3. page_properties.field_id -> collection_fields(id)
--    A collection row can sync before its collection's field definitions.
--    The materialiser stores the raw value and leaves the sort columns null
--    so nothing is lost, then re-projects when the definition arrives. The FK
--    forbade storing the value at all, which would have silently dropped user
--    data during an import.
--
-- Integrity now comes from the rebuild being correct rather than from the
-- constraint, which is the bargain ADR-0002 already struck: the projection is
-- derived data and its consistency is the materialiser's job.
--
-- The ON DELETE CASCADE behaviour those FKs provided is still wanted, so it
-- is reimplemented as a trigger that deletes a page's subtree explicitly, and
-- as an explicit delete of orphaned properties when a field disappears.

BEGIN;

ALTER TABLE pages DROP CONSTRAINT pages_parent_page_id_fkey;
ALTER TABLE pages DROP CONSTRAINT pages_collection_fk;
ALTER TABLE page_properties DROP CONSTRAINT page_properties_field_id_fkey;

-- ---------------------------------------------------------------------------
-- Property cleanup
-- ---------------------------------------------------------------------------

-- Replaces the cascade the field FK used to give us: deleting a field must
-- still take its stored values with it, or page_properties accumulates rows
-- no view can reach.
CREATE FUNCTION delete_field_properties() RETURNS trigger AS $$
BEGIN
  DELETE FROM page_properties WHERE field_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER collection_fields_delete_properties
  AFTER DELETE ON collection_fields
  FOR EACH ROW EXECUTE FUNCTION delete_field_properties();

-- ---------------------------------------------------------------------------
-- Subtree delete
-- ---------------------------------------------------------------------------

-- Replaces the cascade the parent FK used to give us. Uses ancestor_ids
-- rather than a recursive walk: the array is already maintained by the
-- materialiser and indexed with GIN, so this is one indexed delete regardless
-- of subtree depth.
CREATE FUNCTION delete_page_subtree() RETURNS trigger AS $$
BEGIN
  DELETE FROM pages WHERE OLD.id = ANY(ancestor_ids);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pages_delete_subtree
  AFTER DELETE ON pages
  FOR EACH ROW EXECUTE FUNCTION delete_page_subtree();

-- ---------------------------------------------------------------------------
-- Orphan detection
-- ---------------------------------------------------------------------------

-- Without the FK, a page can reference a parent that does not exist — normal
-- during sync, a bug if it persists. This view makes the condition
-- observable so it can be reported rather than discovered.
CREATE VIEW orphaned_pages AS
  SELECT p.id, p.workspace_id, p.parent_page_id, p.title, p.created_at
    FROM pages p
   WHERE p.parent_page_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pages parent WHERE parent.id = p.parent_page_id);

COMMENT ON VIEW orphaned_pages IS
  'Pages whose parent does not exist. Transient during sync; persistent rows indicate a bug or an interrupted import.';

INSERT INTO schema_migrations (version) VALUES ('0003_page_tree_constraints');

COMMIT;
