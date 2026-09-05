-- SONE 0059 — the rights the system roles carry (ADR-0087, step two).
--
-- 0058 made a role a row and left `rights` empty on purpose: a right that
-- nothing consults is a lie, so the names arrive in the change that replaces
-- the hand-written `role = 'owner' OR role = 'admin'` checks with them.
--
-- That change is this one, and there are three names, because there are three
-- things gated by that comparison today:
--
--   people.manage       members and invitations
--   groups.manage       groups and who is in them
--   workspace.settings  the name, the mark, the typography
--
-- Deliberately not here: exporting. Any member may export a whole workspace
-- today, so a `workspace.export` right would either change what SONE does — in
-- a change that is meant to rename things and nothing else — or name a rule
-- nobody enforces. It is a finding, not a right, until somebody decides.
--
-- `owner` and `admin` carry all three. What separates them is transferring and
-- deleting the workspace, which is a column on the membership rather than a
-- right, so that "the last owner cannot be removed" stays enforceable.

BEGIN;

UPDATE roles
   SET rights = ARRAY['people.manage', 'groups.manage', 'workspace.settings']
 WHERE workspace_id IS NULL
   AND key IN ('owner', 'admin');

-- `member` and `guest` keep none, which is what they have today: a member may
-- write in the workspace and may not decide who else is in it.
UPDATE roles
   SET rights = '{}'
 WHERE workspace_id IS NULL
   AND key IN ('member', 'guest');

INSERT INTO schema_migrations (version) VALUES ('0059_role_rights')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
