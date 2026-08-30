-- SONE 0020 — groups (ADR-0026).
--
-- A group names *who*, never what they may do. It is granted access exactly as
-- a person is, and it exists because granting page by page and person by person
-- stops working at around ten people — which is what both Outline and Docmost
-- say in their own documentation, and why both added groups after their
-- permission model rather than as part of it.

BEGIN;

CREATE TABLE IF NOT EXISTS groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Two groups called "Editors" in one workspace are two things nobody can tell
-- apart in a list of who has access.
CREATE UNIQUE INDEX IF NOT EXISTS groups_name_per_workspace
  ON groups (workspace_id, lower(name));

CREATE TABLE IF NOT EXISTS group_members (
  group_id  uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_by_user ON group_members (user_id);

-- Grants to a group, alongside the grants to people that have existed since
-- 0001.
--
-- A second table rather than a nullable subject on page_permissions: that table
-- is keyed (page_id, user_id) and read by claims.ts, and loosening its key to
-- admit a second kind of subject would change the meaning of every existing row
-- and every query over them. Two narrow tables read together is the smaller
-- change and the clearer one.
CREATE TABLE IF NOT EXISTS page_group_permissions (
  page_id         uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  group_id        uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  role            share_role NOT NULL,
  include_subtree boolean NOT NULL DEFAULT true,
  granted_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, group_id)
);

CREATE INDEX IF NOT EXISTS page_group_permissions_by_group
  ON page_group_permissions (group_id);

COMMENT ON TABLE page_group_permissions IS
  'Access granted on a page to a group. Resolved together with '
  'page_permissions, and the more permissive of the two wins — adding somebody '
  'to a group must never reduce what they could already do (ADR-0026).';

INSERT INTO schema_migrations (version) VALUES ('0020_groups')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
