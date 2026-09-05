-- SONE 0064 — say when a workspace's tree changed (ADR-0096).
--
-- `usePages` carried the note for months: somebody else's rename or new page
-- never appeared in a tab left open, and the focus refresh was the whole answer.
-- ADR-0093 gave the sync protocol a nudge with a **scope**, so that the next
-- subject worth pushing would cost no protocol version. This is that subject.
--
-- Addressed by **workspace**, not by person: a tree is a workspace's. The
-- payload is the workspace id and nothing else — the tree route is the one
-- place that decides what somebody may see, and naming the changed page here
-- would put a restricted page's identity on a wire that reaches everybody with
-- the workspace open.
--
-- ## The column list is the whole design
--
-- The projection rewrites a page's row on **every flush**, which is every few
-- hundred milliseconds while somebody types, and `last_edited_at` changes each
-- time. A trigger on any update at all would turn one person's typing into a
-- full tree refetch for every other person in the workspace, several times a
-- second — a push worse than the polling it replaces.
--
-- So the update trigger compares, before and after, exactly the columns the
-- tree draws or resolves a role from. `last_edited_at` is deliberately not
-- among them: it is on screen, and it is not worth a request per keystroke.
-- The focus refresh still catches it.
--
-- Statement-level over transition tables, like 0063 and for the same reason: an
-- import writes a subtree in one statement, and a nudge per row would be a full
-- tree refetch per row for everybody.
BEGIN;

CREATE OR REPLACE FUNCTION notify_pages_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  -- Every trigger below names its transition table `changed`, and every one of
  -- them carries `workspace_id`.
  FOR workspace IN SELECT DISTINCT workspace_id FROM changed
  LOOP
    PERFORM pg_notify('sone_pages_changed', json_build_object('workspaceId', workspace)::text);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

/*
 * The same, for a table that names a page rather than a workspace.
 *
 * A grant, a group grant or a cap changes what an entry **allows** without
 * touching the page row at all — the case ADR-0095 named and left: an entry
 * carries its role now, so a permission that arrives while somebody is looking
 * leaves a rename field on screen that the server will refuse.
 *
 * The join is against `pages`, which is why a delete cascading from a page
 * finds nothing here: the page's own trigger has already said it.
 */
CREATE OR REPLACE FUNCTION notify_pages_access_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN
    SELECT DISTINCT p.workspace_id
      FROM changed c
      JOIN pages p ON p.id = c.page_id
  LOOP
    PERFORM pg_notify('sone_pages_changed', json_build_object('workspaceId', workspace)::text);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pages_notify_insert ON pages;
CREATE TRIGGER pages_notify_insert
  AFTER INSERT ON pages
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_changed();

DROP TRIGGER IF EXISTS pages_notify_delete ON pages;
CREATE TRIGGER pages_notify_delete
  AFTER DELETE ON pages
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_changed();

-- What the tree draws, and what a role is resolved from. Anything not in this
-- list is a change the tree cannot show, and a nudge for it would be a refetch
-- that returns the list it already has.
CREATE OR REPLACE FUNCTION notify_pages_shape_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN
    SELECT DISTINCT after.workspace_id
      FROM changed AS after
      JOIN before ON before.id = after.id
     WHERE after.parent_page_id IS DISTINCT FROM before.parent_page_id
        OR after.collection_id  IS DISTINCT FROM before.collection_id
        OR after.idx            IS DISTINCT FROM before.idx
        OR after.title          IS DISTINCT FROM before.title
        OR after.icon           IS DISTINCT FROM before.icon
        OR after.kind           IS DISTINCT FROM before.kind
        OR after.template       IS DISTINCT FROM before.template
        OR after.locked         IS DISTINCT FROM before.locked
        OR after.archived_at    IS DISTINCT FROM before.archived_at
        OR after.restricted     IS DISTINCT FROM before.restricted
        OR after.ancestor_ids   IS DISTINCT FROM before.ancestor_ids
        OR after.workspace_id   IS DISTINCT FROM before.workspace_id
  LOOP
    PERFORM pg_notify('sone_pages_changed', json_build_object('workspaceId', workspace)::text);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pages_notify_update ON pages;
CREATE TRIGGER pages_notify_update
  AFTER UPDATE ON pages
  REFERENCING OLD TABLE AS before NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_shape_changed();

-- A page moved to another workspace changes two trees (ADR-0038). The clause
-- above catches the new one; this catches the old, which would otherwise go on
-- showing an entry that has left.
CREATE OR REPLACE FUNCTION notify_pages_left_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN
    SELECT DISTINCT before.workspace_id
      FROM before
      JOIN changed AS after ON after.id = before.id
     WHERE after.workspace_id IS DISTINCT FROM before.workspace_id
  LOOP
    PERFORM pg_notify('sone_pages_changed', json_build_object('workspaceId', workspace)::text);
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pages_notify_left ON pages;
CREATE TRIGGER pages_notify_left
  AFTER UPDATE ON pages
  REFERENCING OLD TABLE AS before NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_left_changed();

-- The three tables an entry's role is resolved from, per page.
-- Insert and update as two triggers rather than one with two events:
-- Postgres refuses a transition table on a trigger with more than one event,
-- and the statement-level dedupe is worth more than the shorter spelling.
DROP TRIGGER IF EXISTS page_permissions_notify ON page_permissions;
DROP TRIGGER IF EXISTS page_permissions_notify_insert ON page_permissions;
CREATE TRIGGER page_permissions_notify_insert
  AFTER INSERT ON page_permissions
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_access_changed();

DROP TRIGGER IF EXISTS page_permissions_notify_update ON page_permissions;
CREATE TRIGGER page_permissions_notify_update
  AFTER UPDATE ON page_permissions
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_access_changed();

DROP TRIGGER IF EXISTS page_permissions_notify_delete ON page_permissions;
CREATE TRIGGER page_permissions_notify_delete
  AFTER DELETE ON page_permissions
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_access_changed();

-- Insert and update as two triggers rather than one with two events:
-- Postgres refuses a transition table on a trigger with more than one event,
-- and the statement-level dedupe is worth more than the shorter spelling.
DROP TRIGGER IF EXISTS page_group_permissions_notify ON page_group_permissions;
DROP TRIGGER IF EXISTS page_group_permissions_notify_insert ON page_group_permissions;
CREATE TRIGGER page_group_permissions_notify_insert
  AFTER INSERT ON page_group_permissions
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_access_changed();

DROP TRIGGER IF EXISTS page_group_permissions_notify_update ON page_group_permissions;
CREATE TRIGGER page_group_permissions_notify_update
  AFTER UPDATE ON page_group_permissions
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_access_changed();

DROP TRIGGER IF EXISTS page_group_permissions_notify_delete ON page_group_permissions;
CREATE TRIGGER page_group_permissions_notify_delete
  AFTER DELETE ON page_group_permissions
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_access_changed();

-- Insert and update as two triggers rather than one with two events:
-- Postgres refuses a transition table on a trigger with more than one event,
-- and the statement-level dedupe is worth more than the shorter spelling.
DROP TRIGGER IF EXISTS page_caps_notify ON page_caps;
DROP TRIGGER IF EXISTS page_caps_notify_insert ON page_caps;
CREATE TRIGGER page_caps_notify_insert
  AFTER INSERT ON page_caps
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_access_changed();

DROP TRIGGER IF EXISTS page_caps_notify_update ON page_caps;
CREATE TRIGGER page_caps_notify_update
  AFTER UPDATE ON page_caps
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_access_changed();

DROP TRIGGER IF EXISTS page_caps_notify_delete ON page_caps;
CREATE TRIGGER page_caps_notify_delete
  AFTER DELETE ON page_caps
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_access_changed();

INSERT INTO schema_migrations (version) VALUES ('0064_notify_pages')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
