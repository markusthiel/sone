-- SONE 0065 — one workspace channel, carrying its own scope (ADR-0097).
--
-- ADR-0093 said the scope on the notify frame meant "the next thing worth
-- nudging costs no protocol version", and ADR-0096 repeated it as "the next
-- subject is a constant and a trigger". The protocol half was true. The rest
-- was not: 0064 gave the page tree its **own channel**, so a third subject
-- would have needed a third channel, a third bus handler and its wiring —
-- three copies of a shape that differs only in a string.
--
-- So the channel carries the string. `sone_workspace_changed` with
-- `{workspaceId, scope}` replaces `sone_pages_changed`, and the trash is what
-- the claim promised: a constant and a trigger.
--
-- **What this costs during a deploy.** An instance running the previous release
-- listens on `sone_pages_changed`, which nothing emits after this migration
-- applies. Its clients fall back to the focus refresh until that instance
-- restarts — a page tree that updates when you come back to the tab, for the
-- length of a deploy. Accepted rather than papered over with a release of
-- double emission that somebody then has to remember to remove.
--
-- The trash and the tree overlap on purpose and differ on purpose:
--
--   archive, restore    both lists change
--   permanent delete    the trash, and the tree if the row was still in it
--   rename, move, icon  the tree alone
--
-- One scope for the pair would mean every rename in the workspace refetching a
-- list it cannot have changed — the fault ADR-0096 was written to avoid,
-- arriving from the other side.
BEGIN;

/*
 * The one place the channel name and the payload shape are written.
 *
 * A plain function rather than a trigger function: every trigger below has its
 * own idea of *which* workspaces changed, and none of them should have its own
 * idea of what a notification looks like.
 */
CREATE OR REPLACE FUNCTION notify_workspace(workspace uuid, scope text)
RETURNS void AS $$
BEGIN
  PERFORM pg_notify(
    'sone_workspace_changed',
    json_build_object('workspaceId', workspace, 'scope', scope)::text
  );
END;
$$ LANGUAGE plpgsql;

-- A new page is in the tree and never in the trash.
CREATE OR REPLACE FUNCTION notify_pages_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN SELECT DISTINCT workspace_id FROM changed
  LOOP
    PERFORM notify_workspace(workspace, 'pages');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

/*
 * A deleted row leaves both lists.
 *
 * Both scopes rather than only the trash, because a hard delete is not only
 * "emptied from the trash": a workspace being deleted cascades, and a purge
 * takes rows that were never archived. Deciding here which list it was in would
 * mean reading a row that is gone.
 */
CREATE OR REPLACE FUNCTION notify_pages_deleted() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN SELECT DISTINCT workspace_id FROM changed
  LOOP
    PERFORM notify_workspace(workspace, 'pages');
    PERFORM notify_workspace(workspace, 'trash');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pages_notify_delete ON pages;
CREATE TRIGGER pages_notify_delete
  AFTER DELETE ON pages
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_pages_deleted();

-- What the tree draws, and what a role is resolved from. Unchanged from 0064
-- except for the channel: `last_edited_at` stays outside it, because the
-- projection rewrites the row on every flush and a nudge per keystroke is a
-- push worse than the polling it replaces.
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
    PERFORM notify_workspace(workspace, 'pages');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

/*
 * Archiving and restoring, which is the whole of what moves through the trash.
 *
 * Its own trigger rather than a second scope inside the one above: that one
 * fires for a rename, and a rename cannot change what is in the trash. The two
 * overlap on `archived_at` and nowhere else, which is exactly the relationship
 * between the two lists.
 */
CREATE OR REPLACE FUNCTION notify_trash_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN
    SELECT DISTINCT after.workspace_id
      FROM changed AS after
      JOIN before ON before.id = after.id
     WHERE after.archived_at IS DISTINCT FROM before.archived_at
  LOOP
    PERFORM notify_workspace(workspace, 'trash');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pages_notify_trash ON pages;
CREATE TRIGGER pages_notify_trash
  AFTER UPDATE ON pages
  REFERENCING OLD TABLE AS before NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_trash_changed();

-- A page moved to another workspace leaves both of that workspace's lists
-- (ADR-0038), so the tree it left and the trash it might have been in are both
-- told. The workspace it joined is covered by the shape trigger above.
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
    PERFORM notify_workspace(workspace, 'pages');
    PERFORM notify_workspace(workspace, 'trash');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- A grant, a group grant or a cap changes what an entry allows without touching
-- the page row at all (ADR-0095, ADR-0096).
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
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_migrations (version) VALUES ('0065_notify_workspace')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
