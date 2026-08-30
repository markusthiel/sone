-- SONE 0024 — where somebody lands in a workspace.
--
-- Until now the answer was "the first page in the tree", which is arbitrary:
-- the first page is rarely the one anybody works in, and it changes when
-- somebody reorders the sidebar.
--
-- Per person and per workspace, because a page in one workspace is no use in
-- another — and because two people in the same workspace work on different
-- things.

BEGIN;

CREATE TABLE IF NOT EXISTS workspace_landing (
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,

  -- 'last' follows wherever they were; 'fixed' always opens `page_id`.
  mode         text NOT NULL DEFAULT 'last' CHECK (mode IN ('last', 'fixed')),

  -- The chosen page for 'fixed'. Null with mode 'fixed' means the page was
  -- deleted, which falls back rather than failing: a landing that refuses to
  -- land is worse than an arbitrary one.
  page_id      uuid REFERENCES pages (id) ON DELETE SET NULL,

  -- Where they were, kept regardless of mode. Somebody who switches from
  -- 'fixed' back to 'last' should not have lost the trail.
  last_page_id uuid REFERENCES pages (id) ON DELETE SET NULL,

  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id)
);

COMMENT ON TABLE workspace_landing IS
  'Where each person lands in each workspace: the page they were last on, or '
  'one they chose. Consulted on sign-in, on a workspace switch, and whenever '
  'SONE is opened without a page in the address.';

INSERT INTO schema_migrations (version) VALUES ('0024_landing_page')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
