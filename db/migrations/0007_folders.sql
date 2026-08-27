-- SONE 0007_folders
--
-- Folders as a distinct kind within the existing page tree (ADR-0019).
--
-- Deliberately not a separate table. Share links, page permissions and subtree
-- grants all work on this tree through ancestor_ids; a second tree would need a
-- duplicate of that authorisation path, and a subtly different copy of an
-- access-control rule is how data leaks. One tree, one containment check.
--
-- A folder is a document like a page, with kind 'folder' in its meta, so it is
-- rebuildable from the CRDT log like everything else. A folder that existed only
-- as a row here would make the projection non-derivable, which is the guarantee
-- that makes the CRDT complexity worth carrying (ADR-0002).
--
-- IF NOT EXISTS throughout, and this is not decoration. The first version of
-- this file omitted both the transaction and the schema_migrations row, so it
-- applied its changes and was never recorded — every subsequent start retried it
-- and failed on "column kind already exists", which stopped the server booting
-- and left a blank page. Deployed instances are in exactly that state, and this
-- has to be able to run against them.
--
-- Editing an applied migration normally breaks the append-only rule. It does not
-- here: this file never recorded itself anywhere, so no instance believes it has
-- been applied. That rule protects *recorded* migrations.

BEGIN;

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'page';

-- Added separately and guarded, because ADD COLUMN IF NOT EXISTS skips the
-- whole clause when the column is already there — including the CHECK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pages_kind_check'
  ) THEN
    ALTER TABLE pages
      ADD CONSTRAINT pages_kind_check CHECK (kind IN ('page', 'folder'));
  END IF;
END $$;

-- The sidebar lists a parent's children ordered by (idx, id) and groups by
-- kind, so kind belongs in that index rather than in one of its own.
CREATE INDEX IF NOT EXISTS pages_tree_kind_idx
  ON pages (workspace_id, parent_page_id, kind, idx, id)
  WHERE archived_at IS NULL;

-- A page may contain nothing; only folders may hold children (ADR-0019).
--
-- Reported, not enforced. A CHECK cannot reference another row, and a trigger
-- would reject legitimate data: CRDT updates arrive out of order, so a child can
-- materialise before its parent exists. Migration 0003 dropped three foreign
-- keys for exactly this reason.
--
-- The API refuses to create the situation; this notices if it exists anyway.
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
    AND child.archived_at IS NULL
    AND parent.archived_at IS NULL;

COMMENT ON VIEW pages_inside_pages IS
  'Entries whose parent is a page rather than a folder. Should be empty: the API refuses to create these, so a row here means a client wrote one directly or an update arrived out of order and has not settled yet.';

INSERT INTO schema_migrations (version) VALUES ('0007_folders')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
