-- A search somebody wants to keep (ADR-0050's deferred item).
--
-- Per person, not per workspace, and that is the decision this table encodes.
-- A saved search is a question somebody asks repeatedly — "meine offenen
-- Rechnungen" — and whose question it is matters: `assigned:me` means something
-- different to everybody, so a shared saved search would be a shared string
-- that resolves differently per reader and confuse everyone who did not write
-- it.
--
-- Scoped to a workspace as well as to a person, because the filters name that
-- workspace's tags and people: the same query text in another workspace finds
-- either nothing or the wrong thing.
BEGIN;

CREATE TABLE IF NOT EXISTS saved_searches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- What somebody calls it, and what it actually asks. Both, because a query is
  -- readable and a name is memorable, and neither substitutes for the other.
  name         text NOT NULL,
  query        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- One name per person per workspace: saving over an existing name replaces it,
  -- which is what somebody refining a search means by saving it again.
  UNIQUE (user_id, workspace_id, name)
);

CREATE INDEX IF NOT EXISTS saved_searches_mine_idx
  ON saved_searches (user_id, workspace_id, name);

INSERT INTO schema_migrations (version) VALUES ('0042_saved_searches')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
