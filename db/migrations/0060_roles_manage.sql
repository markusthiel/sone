-- SONE 0060 — the right to define roles (ADR-0087, step three).
--
-- `roles.manage` was in the proposal's list and was left out of 0059 on
-- purpose: the routes it would have guarded did not exist, and a right that
-- nothing consults is a lie — `scripts/check-rights-enforced.mjs` would have
-- refused the build for naming it.
--
-- The routes exist now, so the name does too. Same rule, applied in the same
-- order: write the check, then add the name.
--
-- Held by `owner` and `admin`, which is who could change what a role means
-- before there was anything to change: until now the four roles were four
-- words in the code, and only somebody who could edit the code could alter
-- them.

BEGIN;

UPDATE roles
   SET rights = array_append(rights, 'roles.manage')
 WHERE workspace_id IS NULL
   AND key IN ('owner', 'admin')
   AND NOT ('roles.manage' = ANY(rights));

INSERT INTO schema_migrations (version) VALUES ('0060_roles_manage')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
