-- SONE 0067 — say when access changed, to the server rather than to a client
-- (ADR-0099).
--
-- Claims are resolved once, at authentication, and a document open checks
-- against that snapshot (ADR-0006 rule 1 re-checks the ACL every time — against
-- the snapshot). The tree is fetched over HTTP, where claims are resolved per
-- request. So the two halves of the application can disagree about who somebody
-- is, and both directions of that disagreement are real:
--
--   given    the tree gains an entry and the connection refuses to open it
--   taken    the tree loses it and the open document stays open and writable
--
-- The second is not cosmetic. `SyncServer.revokeAccess` was written for exactly
-- it — "revocation that only affects the next connection is not revocation" —
-- and was called by nothing. The only refresh was the maintenance sweep, every
-- five minutes.
--
-- This channel already carries a workspace id and a scope, so the fix is a
-- scope: `access`. The sync server acts on it and never forwards it — no client
-- wants to know that somebody's access changed *as such*; what a client sees is
-- a document closing, a role changing, or a tree with a new entry.
--
-- **By workspace, deliberately not by page.** A grant on a folder changes access
-- to everything under it, and a page moved changes what its whole subtree
-- inherits. Working out the affected pages in SQL would be a second answer to a
-- question `effectiveRole` already answers per open document.
BEGIN;

-- --- grants on a page ------------------------------------------------------

-- page_permissions, page_group_permissions, page_caps. All three change who may
-- read or write a page, so all three also change what an open connection may
-- do with it.
CREATE OR REPLACE FUNCTION notify_pages_access_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN
    SELECT DISTINCT p.workspace_id
      FROM changed c
      JOIN pages p ON p.id = c.page_id
  LOOP
    PERFORM notify_workspace(workspace, 'pages');
    PERFORM notify_workspace(workspace, 'shares');
    PERFORM notify_workspace(workspace, 'access');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Being added to a group is being given pages (ADR-0098); being removed from
-- one is having them taken away, which is the direction that has to reach an
-- open socket.
CREATE OR REPLACE FUNCTION notify_group_members_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN
    SELECT DISTINCT g.workspace_id
      FROM changed c
      JOIN groups g ON g.id = c.group_id
  LOOP
    PERFORM notify_workspace(workspace, 'pages');
    PERFORM notify_workspace(workspace, 'shares');
    PERFORM notify_workspace(workspace, 'access');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- --- membership of the workspace itself ------------------------------------

/*
 * The largest revocation there is, and it had the same five-minute window:
 * somebody removed from a workspace kept every document they had open.
 *
 * A role change belongs here too — it is what `pageLevel` comes from, so it
 * moves what every page in the workspace allows. And it moves the tree, which
 * is why `pages` is here as well.
 */
CREATE OR REPLACE FUNCTION notify_membership_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN SELECT DISTINCT workspace_id FROM changed
  LOOP
    PERFORM notify_workspace(workspace, 'pages');
    PERFORM notify_workspace(workspace, 'access');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workspace_members_notify_insert ON workspace_members;
CREATE TRIGGER workspace_members_notify_insert
  AFTER INSERT ON workspace_members
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_membership_changed();

DROP TRIGGER IF EXISTS workspace_members_notify_update ON workspace_members;
CREATE TRIGGER workspace_members_notify_update
  AFTER UPDATE ON workspace_members
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_membership_changed();

DROP TRIGGER IF EXISTS workspace_members_notify_delete ON workspace_members;
CREATE TRIGGER workspace_members_notify_delete
  AFTER DELETE ON workspace_members
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_membership_changed();

-- --- share links -----------------------------------------------------------

/*
 * Revoking a link is the revocation this whole idea was named after, and the
 * one with an anonymous editor on the other end of it.
 *
 * Only on update and delete: creating a link changes nothing for anybody
 * already connected, and a revalidation of the workspace for it would be work
 * done to confirm that nothing changed.
 */
CREATE OR REPLACE FUNCTION notify_shares_access_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN SELECT DISTINCT workspace_id FROM changed
  LOOP
    PERFORM notify_workspace(workspace, 'shares');
    PERFORM notify_workspace(workspace, 'access');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS share_tokens_notify_update ON share_tokens;
CREATE TRIGGER share_tokens_notify_update
  AFTER UPDATE ON share_tokens
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_shares_access_changed();

DROP TRIGGER IF EXISTS share_tokens_notify_delete ON share_tokens;
CREATE TRIGGER share_tokens_notify_delete
  AFTER DELETE ON share_tokens
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_shares_access_changed();

-- --- the page's own place in the tree ---------------------------------------

/*
 * A restriction is a fence (ADR-0089) and inheritance follows the ancestry
 * (ADR-0006), so these four columns change who may reach a page without any
 * grant being touched.
 *
 * Its own trigger rather than a branch inside the shape trigger, which also
 * fires for a rename: revalidating every connection in a workspace on every
 * rename is the cost this whole line of work exists to avoid.
 */
CREATE OR REPLACE FUNCTION notify_page_access_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN
    SELECT DISTINCT after.workspace_id
      FROM changed AS after
      JOIN before ON before.id = after.id
     WHERE after.restricted     IS DISTINCT FROM before.restricted
        OR after.parent_page_id IS DISTINCT FROM before.parent_page_id
        OR after.ancestor_ids   IS DISTINCT FROM before.ancestor_ids
        OR after.workspace_id   IS DISTINCT FROM before.workspace_id
  LOOP
    PERFORM notify_workspace(workspace, 'access');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pages_notify_access ON pages;
CREATE TRIGGER pages_notify_access
  AFTER UPDATE ON pages
  REFERENCING OLD TABLE AS before NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_page_access_changed();

-- A deleted page has no access left to resolve, and a connection holding it
-- should be told rather than left with a handle onto nothing.
CREATE OR REPLACE FUNCTION notify_pages_deleted() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN SELECT DISTINCT workspace_id FROM changed
  LOOP
    PERFORM notify_workspace(workspace, 'pages');
    PERFORM notify_workspace(workspace, 'trash');
    PERFORM notify_workspace(workspace, 'shares');
    PERFORM notify_workspace(workspace, 'access');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Left alone on purpose: `roles`. Changing what a role *means* changes access
-- for everybody holding it, and a system role is held in every workspace — so
-- one edit would revalidate the whole instance. The five-minute sweep covers
-- it, and doing better needs a decision about how, not another trigger.

INSERT INTO schema_migrations (version) VALUES ('0067_notify_access')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
