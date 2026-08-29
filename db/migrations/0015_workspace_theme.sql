-- SONE 0015 — a workspace's own defaults for how elements look (ADR-0023).
--
-- DECORATIVE, in the same sense as workspace_tag_colors: losing this table
-- costs appearance and never content. Every document renders without it exactly
-- as every document rendered before it existed.
--
-- It fills gaps rather than overriding. A block attribute of null means "as the
-- design decides" — that was the point of writing it as null rather than as an
-- explicit default — and this is what decides. A block that carries its own
-- value keeps it, because somebody chose it.
--
-- One row per workspace, holding a JSON object keyed by element kind. jsonb
-- rather than a column per property: the set of properties is expected to grow,
-- and adding a migration for each would be a lot of ceremony for values nothing
-- joins on and nothing queries by.

BEGIN;

CREATE TABLE IF NOT EXISTS workspace_themes (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  -- { "heading1": { "size": 2, "color": "blue", "spaceAbove": 1 }, ... }
  -- Validated in the server against closed lists before it is written; stored
  -- as given so an unknown key added by a newer version is not silently
  -- destroyed by an older one.
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE workspace_themes IS
  'Per-workspace defaults for element appearance. Decorative: losing this '
  'costs appearance and never content, and a workspace with no row renders '
  'the way every workspace did before themes existed (ADR-0023).';

INSERT INTO schema_migrations (version) VALUES ('0015_workspace_theme')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
