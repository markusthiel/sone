-- SONE 0018 — inviting somebody to the instance, not only to a workspace
-- (ADR-0025).
--
-- Until now an invitation always named a workspace, so there was no way to say
-- "have an account here" without also saying "and belong to this team". Those
-- are two decisions and an administrator often only wants to make the first.

BEGIN;

-- An invitation without a workspace is an invitation to the instance.
--
-- Nullable rather than a second table: everything else about an invitation is
-- the same — a token, an address, an expiry, a count of uses — and two tables
-- would mean two of every query that answers "is this token any good".
ALTER TABLE invitations
  ALTER COLUMN workspace_id DROP NOT NULL;

COMMENT ON COLUMN invitations.workspace_id IS
  'The workspace to join, or null for an invitation to the instance alone. '
  'Somebody accepting the latter ends up in their own workspace and nowhere '
  'else (ADR-0025).';

-- A role without a workspace means nothing, and storing one would invite a
-- reader to believe it applies somewhere.
ALTER TABLE invitations
  ADD CONSTRAINT invitations_role_needs_workspace
  CHECK (workspace_id IS NOT NULL OR role = 'member');

INSERT INTO schema_migrations (version) VALUES ('0018_instance_invitations')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
