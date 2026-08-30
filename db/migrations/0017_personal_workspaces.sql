-- SONE 0017 — everybody has a workspace of their own (ADR-0025).
--
-- A notes application whose first screen is empty because nobody has invited
-- you anywhere has failed at the thing it is for.

BEGIN;

-- Which workspace is somebody's own.
--
-- A column on workspaces rather than a table: it is a property of the workspace
-- (whose is it), and a workspace has at most one owner in this sense. A join
-- table would allow two, which is not a state anything here could act on.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS personal_for uuid REFERENCES users (id) ON DELETE CASCADE;

-- One personal workspace per person. Without this a repeated migration or a
-- retried sign-up quietly gives somebody two, and nothing would show it.
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_one_personal_per_user
  ON workspaces (personal_for)
  WHERE personal_for IS NOT NULL;

COMMENT ON COLUMN workspaces.personal_for IS
  'The person whose own workspace this is, or null for a shared one. An '
  'ordinary workspace otherwise — nothing else in the application special-cases '
  'it (ADR-0025).';

-- Everybody who has none gets one.
--
-- Named after the person rather than "Personal", because it appears in a
-- switcher beside workspaces that have real names, and "Personal" twice in a
-- list of three is not a name.
WITH created AS (
  INSERT INTO workspaces (name, personal_for, created_by)
  SELECT u.display_name, u.id, u.id
  FROM users u
  WHERE NOT EXISTS (
    SELECT 1 FROM workspaces w WHERE w.personal_for = u.id
  )
  RETURNING id, personal_for
)
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT c.id, c.personal_for, 'owner'
FROM created c
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('0017_personal_workspaces')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
