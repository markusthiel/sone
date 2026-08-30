-- SONE 0022 — a right that can be given away (ADR-0027).
--
-- Until now there were two states: instance administrator, or not. Managing
-- workspaces becomes a third, granted separately, so a job can be handed over
-- without handing over the instance.
--
-- Deliberately narrow: create, edit, invite to and delete workspaces, and set
-- who is in them. Not accounts, not single sign-on, not maintenance. A right
-- that covers everything except one thing is an administrator under another
-- name.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_manage_workspaces boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.can_manage_workspaces IS
  'May administer every workspace on this instance: membership, roles, '
  'invitations, deletion. Does not grant reading their pages — somebody who '
  'wants that adds themselves as a member, which the members list shows '
  '(ADR-0027).';

-- An instance administrator has it implicitly, and storing it as well would be
-- two sources for one answer. The check belongs in code, where it can say so.
--
-- Nobody is granted it here: a right that arrives already given to people is
-- one nobody decided to give.

INSERT INTO schema_migrations (version) VALUES ('0022_manage_workspaces')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
