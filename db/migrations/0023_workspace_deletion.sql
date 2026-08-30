-- SONE 0023 — deleting a workspace, reversibly for a while (ADR-0027).
--
-- The only irreversible action in the workspace administration, and the one
-- that takes everybody's pages with it. So it is marked first and removed
-- later: somebody who deletes the wrong one has a way back, and the way back
-- has to exist before the button does.

BEGIN;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users (id) ON DELETE SET NULL;

COMMENT ON COLUMN workspaces.deleted_at IS
  'When this workspace was marked for deletion. Nothing is removed at that '
  'point: it stops appearing to its members and can be restored until it is '
  'purged (ADR-0027).';

-- Listing what is live is the common query, so the index covers it rather than
-- the rarer question of what is scheduled.
CREATE INDEX IF NOT EXISTS workspaces_live_idx
  ON workspaces (id)
  WHERE deleted_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('0023_workspace_deletion')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
