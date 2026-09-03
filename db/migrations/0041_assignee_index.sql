-- Finding somebody's tasks (ADR-0050's filters, ADR-0052's assignments).
--
-- The assignment is already projected: block props go into blocks.props, so
-- nothing new is stored here. What was missing is a way to ask the question
-- without reading every block in the workspace.
--
-- A partial index over tasks that have an assignee. Partial because almost no
-- block is one: an index over every block's props would be the size of the
-- props and answer a question about a fraction of them.
BEGIN;

CREATE INDEX IF NOT EXISTS blocks_assignee_idx
  ON blocks ((props ->> 'assignee'))
  WHERE type = 'todo' AND props ? 'assignee';

INSERT INTO schema_migrations (version) VALUES ('0041_assignee_index')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
