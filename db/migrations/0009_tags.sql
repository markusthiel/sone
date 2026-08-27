-- SONE 0009_tags
--
-- Tags as names on a page, with the workspace's tag list derived from use
-- (ADR-0020).
--
-- No tags table. A tag exists because a page carries it; there is nowhere to
-- create one and nowhere for an unused one to linger. "The tags in this
-- workspace" is a query over this table, which means the tag list is
-- rebuildable from the CRDT log like everything else — a registry would not be,
-- because no document owns it.
--
-- Two columns rather than one: `tag_key` is what matching and grouping use,
-- `tag_label` is the spelling to show. `Meeting` and `meeting` are one tag, and
-- the first spelling used is the one people see.

BEGIN;

CREATE TABLE page_tags (
  page_id      uuid NOT NULL,
  workspace_id uuid NOT NULL,
  -- Normalised: trimmed, inner whitespace collapsed, lowercased.
  tag_key      text NOT NULL,
  -- As typed. Two pages may disagree on capitalisation; the workspace list
  -- picks one, and which one is a display detail rather than a correctness
  -- question.
  tag_label    text NOT NULL,
  PRIMARY KEY (page_id, tag_key)
);

-- No foreign key to pages, for the reason migration 0003 dropped the tree's:
-- these rows are written by the materialiser from CRDT updates, which arrive in
-- any order, so a constraint would reject data that is merely early. The
-- materialiser deletes a page's rows before writing them, so a page that is
-- removed leaves none behind.

-- "Every tag in this workspace, with counts" and "every page with this tag" are
-- the two queries that exist. Both are covered by this index.
CREATE INDEX page_tags_workspace_idx ON page_tags (workspace_id, tag_key, page_id);

-- The reverse direction, for showing a page's own tags during materialisation
-- and for deleting them.
CREATE INDEX page_tags_page_idx ON page_tags (page_id);

COMMENT ON TABLE page_tags IS
  'Tags carried by pages, projected from their documents. Not authoritative: '
  'the document is (ADR-0002). There is deliberately no tags table, so an '
  'unused tag simply stops existing.';

INSERT INTO schema_migrations (version) VALUES ('0009_tags')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
