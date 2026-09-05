-- SONE 0068 — say when what a role *means* changed (ADR-0100).
--
-- The last thing ADR-0099 left out, with a reason: "a system role is held in
-- every workspace — so one edit would revalidate the whole instance. The
-- five-minute sweep covers it, and doing better needs a decision about how, not
-- another trigger."
--
-- The decision is here, and it is two halves.
--
-- ## Half one: `page_level` is the access change, `rights` is not
--
-- A role has two halves (ADR-0087): `page_level` is what it gives on a page in
-- this workspace, and `rights` is what it may **administer** — members, groups,
-- settings, roles. Rights are read per request by the HTTP routes that check
-- them; they have nothing to do with a document. So revalidating every
-- connection in a workspace because somebody ticked a box in the roles screen
-- is work done to confirm that nothing changed.
--
-- Comparing only `page_level` is what makes this trigger affordable, and it is
-- the same narrowing the tree's trigger makes about `last_edited_at`.
--
-- ## Half two: name the workspaces that hold the role
--
-- A custom role belongs to one workspace and says so. A system role belongs to
-- none and is held in many — so instead of "every workspace", the notification
-- names the ones where somebody or some group actually holds it. That is a
-- query, and it is bounded by the truth rather than by the schema.
--
-- It stays rare regardless: the settings screen refuses to edit a built-in role
-- (ADR-0087), so a system role changes only by hand or by migration. What this
-- removes is the case where somebody does that and nothing happens for five
-- minutes.
--
-- ## And the group that holds one
--
-- A group can hold a role, and `loadWorkspaceStanding` reads it. So pointing a
-- group at a different role changes what every member of it gets, without
-- touching a membership, a grant or a page — the same act as editing the role,
-- one join further out.
BEGIN;

/*
 * Which workspaces a role is held in.
 *
 * For a custom role that is its own `workspace_id` and the query is a formality.
 * For a system role it is wherever a membership or a group points at it —
 * which for `member` is every workspace with people in it, and for a role
 * nobody holds is none at all.
 */
CREATE OR REPLACE FUNCTION notify_role_meaning_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN
    SELECT DISTINCT ws
      FROM (
        SELECT after.workspace_id AS ws
          FROM changed AS after
          JOIN before ON before.id = after.id
         WHERE after.page_level IS DISTINCT FROM before.page_level
           AND after.workspace_id IS NOT NULL
        UNION
        SELECT m.workspace_id AS ws
          FROM changed AS after
          JOIN before ON before.id = after.id
          JOIN workspace_members m ON m.role_id = after.id
         WHERE after.page_level IS DISTINCT FROM before.page_level
           AND after.workspace_id IS NULL
        UNION
        SELECT g.workspace_id AS ws
          FROM changed AS after
          JOIN before ON before.id = after.id
          JOIN groups g ON g.role_id = after.id
         WHERE after.page_level IS DISTINCT FROM before.page_level
           AND after.workspace_id IS NULL
      ) AS affected
     WHERE ws IS NOT NULL
  LOOP
    -- Both: what a role gives decides what the tree shows and what each entry
    -- allows (ADR-0095), and it decides what an open document may do.
    PERFORM notify_workspace(workspace, 'pages');
    PERFORM notify_workspace(workspace, 'access');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Update only. A role inserted is held by nobody, and a role deleted is refused
-- while anybody holds it (ADR-0087) — so neither can change what a live
-- connection may do.
DROP TRIGGER IF EXISTS roles_notify_update ON roles;
CREATE TRIGGER roles_notify_update
  AFTER UPDATE ON roles
  REFERENCING OLD TABLE AS before NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_role_meaning_changed();

/*
 * A group pointed at a different role.
 *
 * Only `role_id`: a group's name is on the shares screen as "via the group X"
 * and is cosmetic there (ADR-0098), and its membership has its own trigger
 * already.
 */
CREATE OR REPLACE FUNCTION notify_group_role_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN
    SELECT DISTINCT after.workspace_id
      FROM changed AS after
      JOIN before ON before.id = after.id
     WHERE after.role_id IS DISTINCT FROM before.role_id
  LOOP
    PERFORM notify_workspace(workspace, 'pages');
    PERFORM notify_workspace(workspace, 'access');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS groups_notify_role ON groups;
CREATE TRIGGER groups_notify_role
  AFTER UPDATE ON groups
  REFERENCING OLD TABLE AS before NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_group_role_changed();

INSERT INTO schema_migrations (version) VALUES ('0068_notify_role_meaning')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
