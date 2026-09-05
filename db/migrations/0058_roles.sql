-- SONE 0058 — a role is a name for a set of rights (ADR-0087).
--
-- Until now a role was a string type in TypeScript and a Postgres enum, and its
-- meaning was a `switch` statement in two files. There was no read-only
-- membership, because `member` maps to `editor` on every page that is not
-- restricted and nothing sits between "may write everything" and "may see
-- nothing without an explicit grant".
--
-- This migration makes a role a row. It changes no behaviour: the four roles
-- that exist become four system roles carrying exactly what the switch
-- statements gave them, and every membership is pointed at the matching one.
--
-- The enum column stays, unread, until a later migration drops it. Removing it
-- in the same change as adding the table would mean a deployment where a
-- rollback loses the mapping.

BEGIN;

-- Rights are text rather than an enum.
--
-- An enum needs a migration to add a value, and the enumeration is expected to
-- grow every time a hand-written owner/admin check is replaced by a named
-- right. What keeps it honest is not the column type: it is
-- `scripts/check-rights-enforced.mjs`, which fails the build when a right in
-- the code's enumeration is not consulted by any server-side check. A right
-- nobody checks is a lie, and a lie in a permission screen is worse than a
-- missing feature — somebody turns the switch off and believes something.
CREATE TABLE IF NOT EXISTS roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL for a system role: it exists in every workspace, cannot be edited and
  -- cannot be deleted. A custom role names the workspace it belongs to.
  workspace_id uuid REFERENCES workspaces (id) ON DELETE CASCADE,

  -- How a system role is looked up. NULL for a custom role, which is found by
  -- its id and shown by its name.
  key          text,

  name         text NOT NULL,

  -- What this role gives on a page in this workspace that carries no rules of
  -- its own. NULL is ADR-0087's `none`: nothing at all without an explicit
  -- grant, which is what `guest` means today.
  --
  -- `share_role` rather than a new type, for ADR-0026's reason: a second
  -- vocabulary for the same four words would have to be translated at every
  -- boundary, and the translation is where the two would drift.
  page_level   share_role,

  rights       text[] NOT NULL DEFAULT '{}',

  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- A row is one or the other. A system role with a workspace would be a
  -- built-in that exists in one place, and a custom role without one would be
  -- a workspace's rule leaking into every other workspace.
  CONSTRAINT roles_system_or_custom CHECK (
    (workspace_id IS NULL AND key IS NOT NULL)
    OR (workspace_id IS NOT NULL AND key IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS roles_system_key ON roles (key) WHERE key IS NOT NULL;

-- Two roles called "Redaktion" in one workspace are two things nobody can tell
-- apart in a list of who may do what. The same reasoning as groups_name_per_workspace.
CREATE UNIQUE INDEX IF NOT EXISTS roles_name_per_workspace
  ON roles (workspace_id, lower(name)) WHERE workspace_id IS NOT NULL;

-- The four that exist today, carrying exactly what the switch statements gave
-- them.
--
-- `owner` and `admin` are identical here, and that is not an oversight: what
-- separates them is transferring and deleting the workspace, which stays a
-- property of the membership rather than a right. "The last owner cannot be
-- removed" is enforceable against a column; against a role it becomes "the last
-- person holding a role that includes deletion", to be recomputed on every role
-- edit, and a workspace whose last owner-ish role was edited by mistake is one
-- nobody can administer (ADR-0087).
--
-- The rights lists are empty. They are filled in the change that replaces the
-- hand-written `role = 'owner' OR role = 'admin'` checks with named rights, so
-- that no row here ever claims a right that nothing consults.
INSERT INTO roles (workspace_id, key, name, page_level, rights) VALUES
  (NULL, 'owner',  'Owner',  'admin',  '{}'),
  (NULL, 'admin',  'Admin',  'admin',  '{}'),
  (NULL, 'member', 'Member', 'editor', '{}'),
  (NULL, 'guest',  'Guest',  NULL,     '{}')
ON CONFLICT DO NOTHING;

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles (id);

-- Ownership becomes a column, because it is not a right (ADR-0087).
--
-- "The last owner cannot be removed" has to be enforceable. Against a column it
-- is one query. Against a role it becomes "the last person holding a role that
-- includes deletion", recomputed on every role edit — and a workspace whose
-- last owner-ish role was edited by mistake is one nobody can administer.
--
-- It also means assigning somebody a custom role cannot silently stop them
-- being the owner.
ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;

UPDATE workspace_members SET is_owner = true WHERE role = 'owner' AND NOT is_owner;

-- A group can hold a role, which is how "assign a role to a group" works
-- (ADR-0087). NULL means the group grants no role — which is every group today,
-- and stays the default.
ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles (id);

-- Every existing membership keeps exactly what it had.
UPDATE workspace_members m
   SET role_id = r.id
  FROM roles r
 WHERE r.key = m.role::text
   AND m.role_id IS NULL;

-- After the backfill, so the constraint describes the state the table is in.
-- Not NOT NULL: a membership row inserted by an older server that has not yet
-- restarted would fail, and a failed insert during a rolling deploy is worse
-- than a row the loader falls back on.
CREATE INDEX IF NOT EXISTS workspace_members_role_idx ON workspace_members (role_id);

COMMENT ON TABLE roles IS
  'A role is (a default page level, a set of workspace rights). The page level '
  'stays a ladder because a page is a CRDT document the server either serves or '
  'does not; the rights are a set because "may manage groups" and "may export" '
  'have no order between them (ADR-0087).';

COMMENT ON COLUMN roles.page_level IS
  'What this role gives on a page carrying no rules of its own. NULL means '
  'nothing without an explicit grant, which is what guest means today.';

COMMENT ON COLUMN workspace_members.role IS
  'Superseded by role_id and is_owner (ADR-0087). Nothing reads it: what it '
  'said is now the role row it points at, and ownership is its own column. '
  'Kept so a rollback does not lose the mapping; dropped in a later migration.';

INSERT INTO schema_migrations (version) VALUES ('0058_roles')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
