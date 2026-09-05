-- SONE 0066 — say when a workspace's shares screen changed (ADR-0098).
--
-- The fourth subject on the notify frame, and the first that cost what ADR-0093
-- promised and ADR-0097 made true: a constant and a trigger. No channel, no bus
-- handler, no wiring — `notify_workspace(workspace, 'shares')` and the question
-- of *which* changes belong to this screen.
--
-- Three lists (ADR-0088): links, what this person granted, what was granted to
-- them. So:
--
--   share_tokens                created, revoked, changed
--   page_permissions            given, changed, taken away  — and the tree too
--   page_group_permissions      the same
--   group_members               joined or left — a group grant reaches members
--   pages.archived_at, DELETE   every one of the three queries ends
--                               `AND p.archived_at IS NULL`
--
-- **`group_members` also nudges the tree, and nothing did before.** A group
-- grant reaches its members, so being added to a group is being given pages —
-- and the page tree went on showing what it showed before until the next focus.
-- A gap in 0064's trigger set, found by asking which changes belong to the
-- shares screen.
--
-- What is deliberately absent: a rename. The screen shows a page's title, so a
-- rename does make one row read differently — and nudging on it would be a
-- request per rename per person with the screen open, for a word. The focus
-- refresh catches it, which is what the focus refresh is for.
BEGIN;

-- --- links -----------------------------------------------------------------

-- `share_tokens` carries `workspace_id` itself, so no join. Revoking is an
-- UPDATE of `revoked_at` rather than a delete — a revoked link is history, and
-- the list stops showing it (ADR-0088).
CREATE OR REPLACE FUNCTION notify_shares_changed() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN SELECT DISTINCT workspace_id FROM changed
  LOOP
    PERFORM notify_workspace(workspace, 'shares');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- One trigger per event: Postgres refuses a transition table on a trigger with
-- more than one, and the statement-level dedupe is worth more than the shorter
-- spelling.
DROP TRIGGER IF EXISTS share_tokens_notify_insert ON share_tokens;
CREATE TRIGGER share_tokens_notify_insert
  AFTER INSERT ON share_tokens
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_shares_changed();

DROP TRIGGER IF EXISTS share_tokens_notify_update ON share_tokens;
CREATE TRIGGER share_tokens_notify_update
  AFTER UPDATE ON share_tokens
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_shares_changed();

DROP TRIGGER IF EXISTS share_tokens_notify_delete ON share_tokens;
CREATE TRIGGER share_tokens_notify_delete
  AFTER DELETE ON share_tokens
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_shares_changed();

-- --- grants ----------------------------------------------------------------

-- A grant is on both screens: it appears in "granted" and in the other person's
-- "received", and it changes what their tree shows and what each entry allows
-- (ADR-0095). Two scopes on one change, like archiving.
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
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

/*
 * Being added to a group is being given pages.
 *
 * "received" lists a group grant with "via the group X", because "why do I have
 * this" is the question somebody has when they find a page they did not expect
 * (ADR-0088). So a membership is a share.
 *
 * And it is a tree change, which nothing announced until now: a group grant
 * reaches its members, so somebody joining a group gains pages and their
 * sidebar went on showing what it showed before.
 */
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
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS group_members_notify_insert ON group_members;
CREATE TRIGGER group_members_notify_insert
  AFTER INSERT ON group_members
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_group_members_changed();

DROP TRIGGER IF EXISTS group_members_notify_delete ON group_members;
CREATE TRIGGER group_members_notify_delete
  AFTER DELETE ON group_members
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_group_members_changed();

-- --- what takes a row off the screen without anybody sharing anything -------

/*
 * Archiving and restoring, which moves a page through three lists at once.
 *
 * The trash gains or loses it, the tree loses or gains it — and all three
 * queries behind the shares screen end `AND p.archived_at IS NULL`, so its rows
 * go too. A row left behind there is a row somebody clicks and gets a refusal
 * for something they could not have known.
 *
 * Renamed from `notify_trash_changed` (0065) now that it speaks for two
 * screens: a function whose name claims one subject and emits two is a name
 * somebody will trust.
 */
CREATE OR REPLACE FUNCTION notify_archived_changed() RETURNS trigger AS $$
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
    PERFORM notify_workspace(workspace, 'shares');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pages_notify_trash ON pages;
DROP TRIGGER IF EXISTS pages_notify_archived ON pages;
CREATE TRIGGER pages_notify_archived
  AFTER UPDATE ON pages
  REFERENCING OLD TABLE AS before NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION notify_archived_changed();

DROP FUNCTION IF EXISTS notify_trash_changed();

-- A deleted page leaves every list there is, and its links and grants go with
-- it by cascade. Which list it was in is not a question worth answering: it
-- would mean reading a row that is gone.
CREATE OR REPLACE FUNCTION notify_pages_deleted() RETURNS trigger AS $$
DECLARE
  workspace uuid;
BEGIN
  FOR workspace IN SELECT DISTINCT workspace_id FROM changed
  LOOP
    PERFORM notify_workspace(workspace, 'pages');
    PERFORM notify_workspace(workspace, 'trash');
    PERFORM notify_workspace(workspace, 'shares');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- A page that leaves for another workspace leaves all of that workspace's
-- lists (ADR-0038).
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
    PERFORM notify_workspace(workspace, 'shares');
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_migrations (version) VALUES ('0066_notify_shares')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
