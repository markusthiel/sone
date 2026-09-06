-- SONE 0073 — a workspace decides where people land; a person may differ.
--
-- Migration 0024 made the landing choice per person *and* per workspace, for
-- good reasons that still hold:
--
--   Per person and per workspace, because a page in one workspace is no use in
--   another — and because two people in the same workspace work on different
--   things.
--
-- What it did not have was a place to say it. The screen went into the personal
-- settings, which have exactly one workspace in scope — whichever the person is
-- standing in — so it silently edited one workspace's row while looking like a
-- preference about the person. Reported as: *„Die Einstellung ist Workspace
-- gebunden. Dort kann ich also nur auswählen aus den Seiten in dem Workspace in
-- dem ich gerade bin. Das macht da keinen Sinn."*
--
-- ## Two things, and they were one column
--
-- **A workspace has a first page.** New members should land on the page that
-- says what this place is for. That was not expressible at all.
--
-- **A person may work somewhere else.** That is what 0024 built, and it stays.
--
-- So the default moves onto the workspace, and the per-person row becomes an
-- override: `mode IS NULL` means "whatever the workspace says".
--
-- ## Existing rows: 'last' was never a choice
--
-- `PUT …/landing` records where somebody is on every page, and it inserts with
-- `COALESCE($3,'last')` — so nearly every row holds 'last' because it was
-- written by the "remember where I am" call, not because anybody chose it. Read
-- as a deliberate override, those rows would pin every existing member to
-- 'last' for ever and make the new workspace default unreachable for exactly
-- the people it is meant for.
--
-- They become NULL. Behaviour is unchanged today, because the workspace default
-- is 'last' as well; what changes is that an admin setting a first page will
-- now reach them. A 'fixed' row is a real choice and is kept.

BEGIN;

ALTER TABLE workspaces
  ADD COLUMN landing_mode text NOT NULL DEFAULT 'last'
    CHECK (landing_mode IN ('last', 'top', 'newest', 'fixed')),
  -- The page for 'fixed'. Null with mode 'fixed' means it was deleted, which
  -- falls back rather than failing — the same rule 0024 wrote for the personal
  -- one: a landing that refuses to land is worse than an arbitrary one.
  ADD COLUMN landing_page_id uuid REFERENCES pages (id) ON DELETE SET NULL;

COMMENT ON COLUMN workspaces.landing_mode IS
  'Where members land here unless they have said otherwise: the page they were '
  'last on, the top of the tree, the most recently edited page, or a chosen one.';

-- The personal row becomes an override.
ALTER TABLE workspace_landing DROP CONSTRAINT IF EXISTS workspace_landing_mode_check;
ALTER TABLE workspace_landing ALTER COLUMN mode DROP DEFAULT;
ALTER TABLE workspace_landing ALTER COLUMN mode DROP NOT NULL;

-- Before the new constraint, because 'last' rows are about to become null and a
-- constraint that allowed both would be checked against rows on their way out.
UPDATE workspace_landing SET mode = NULL WHERE mode = 'last';

ALTER TABLE workspace_landing ADD CONSTRAINT workspace_landing_mode_check
  CHECK (mode IS NULL OR mode IN ('last', 'top', 'newest', 'fixed'));

COMMENT ON COLUMN workspace_landing.mode IS
  'This person''s own answer for this workspace, or NULL to follow the '
  'workspace''s (migration 0073).';

INSERT INTO schema_migrations (version) VALUES ('0073_a_workspace_has_a_first_page');

COMMIT;
