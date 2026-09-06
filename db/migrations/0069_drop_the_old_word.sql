-- SONE 0069 — drop `workspace_members.role` (ADR-0102).
--
-- Migration 0058 added `role_id`, backfilled it, and wrote this on the column
-- it superseded:
--
--   'Superseded by role_id and is_owner (ADR-0087). Nothing reads it: what it
--    said is now the role row it points at, and ownership is its own column.
--    Kept so a rollback does not lose the mapping; dropped in a later
--    migration.'
--
-- "Nothing reads it" was false the day it was written. `/api/auth/session` and
-- `/api/workspaces` both selected `m.role` — both older than this migration —
-- and handed it to the browser, where the settings screen decided from it
-- whether to disable every control and the move dialog decided which
-- workspaces to offer. Somebody holding `workspace.settings` through a custom
-- role was told they were a `member` and given a screen of dead inputs, because
-- assigning a custom role wrote the nearest of the four words.
--
-- This is the later migration. It is the **contract** half of an expand and
-- contract: 0058 expanded, every server since has written both columns, and
-- this one removes the old shape once nothing needs it. A server from before
-- 0058 cannot run against this schema, which is what dropping a column means
-- and is why the two halves are eleven migrations apart.
BEGIN;

/*
 * Backfill again before forbidding the state.
 *
 * 0058 pointed every membership at a role. Rows written *since* by a server
 * mid-deploy, or restored from a dump older than 0058, can still carry the word
 * and no role — which is precisely the case the two compatibility bridges in
 * `standing.ts` existed to rescue. The bridges go with the column, so the state
 * has to be impossible rather than merely handled.
 *
 * Idempotent and cheap: on an instance that has been running current code this
 * matches nothing.
 */
UPDATE workspace_members m
   SET role_id = r.id
  FROM roles r
 WHERE r.key = m.role::text
   AND r.workspace_id IS NULL
   AND m.role_id IS NULL;

/*
 * A membership with no role resolves to no access at all — a member of a
 * workspace who can see nothing in it, which reads exactly like being thrown
 * out. It was reachable and it is now refused.
 *
 * A constraint rather than a convention, because the previous arrangement was a
 * convention and thirty test fixtures broke it without anybody noticing: every
 * one of them wrote the enum column alone, so the whole suite's access
 * assertions were resolved through the bridge rather than through the path the
 * running server takes.
 */
ALTER TABLE workspace_members
  ALTER COLUMN role_id SET NOT NULL;

ALTER TABLE workspace_members
  DROP COLUMN role;

COMMENT ON COLUMN workspace_members.role_id IS
  'The role this membership holds — a system role or one this workspace made '
  '(ADR-0087). NOT NULL since ADR-0102: a membership pointing at nothing '
  'resolves to no access, which is indistinguishable from being removed.';

/*
 * The type stays, and not by omission.
 *
 * `invitations.role` still uses it, still means one of the four words, and is
 * read on every acceptance. An invitation cannot offer a custom role today —
 * there is no screen for it and no column to hold one — so the enum is carrying
 * a real meaning there rather than a leftover. Dropping the type would mean
 * deciding that question, which is a different change.
 */
COMMENT ON TYPE workspace_role IS
  'The four system role names. Used by invitations.role only; '
  'workspace_members points at a roles row instead (ADR-0087, ADR-0102).';

INSERT INTO schema_migrations (version) VALUES ('0069_drop_the_old_word')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
