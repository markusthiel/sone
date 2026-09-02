-- A page that is a shape to start from (ADR-0045).
--
-- A flag on `pages` rather than a kind or a table of its own: a template is an
-- ordinary page, written with the same editor and permissioned by the same
-- rules, and every alternative meant reimplementing page features for it.
--
-- Not null with a default, unlike `width`: here there is no third state. A page
-- either is offered as a template or is not, and nobody needs to distinguish
-- "not a template" from "nobody has said".
ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS template boolean NOT NULL DEFAULT false;

-- The list is read per workspace, and it is short.
CREATE INDEX IF NOT EXISTS pages_templates_idx
  ON pages (workspace_id) WHERE template AND archived_at IS NULL;
