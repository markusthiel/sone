-- SONE 0012 — chosen colours for tags.
--
-- DECORATIVE. Read the sentence twice, because the next person will assume
-- otherwise: losing this table loses chosen colours and never loses a tag.
--
-- A tag is a name on a page document and nothing else (ADR-0020). Every tag
-- already has a colour derived from that name — the same name is the same
-- colour for everybody, with nothing stored — and this table only records where
-- a workspace wanted a different one.
--
-- Keyed by the normalised tag name rather than by an id, deliberately. An id
-- would make this a registry: the authority on which tags exist, which is
-- exactly what ADR-0020 rejected because it is not rebuildable from the CRDT log
-- and because two people creating the same tag offline would produce two ids. A
-- row for a name nobody uses is simply never read; a tag with no row is not
-- missing anything.
--
-- Nothing may read this table to decide what a tag *is*.

BEGIN;

CREATE TABLE IF NOT EXISTS workspace_tag_colors (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- The normalised form, as produced by tagKey() in @sone/core. Matching on the
  -- normalised name is what makes "Urgent" and "urgent" one tag here as well as
  -- in the documents.
  tag_key      text NOT NULL,
  -- A palette name, not a colour value: a name survives a theme change where a
  -- stored hex cannot, and a fixed palette keeps a page legible. Same reasoning
  -- as select options.
  color        text NOT NULL,
  set_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  set_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, tag_key)
);

COMMENT ON TABLE workspace_tag_colors IS
  'Decorative overrides for tag colours. Losing this table loses chosen colours '
  'and never loses a tag: every tag has a colour derived from its name, and the '
  'tags themselves live in the page documents. Not a registry — nothing may '
  'read this to decide which tags exist (ADR-0020).';

INSERT INTO schema_migrations (version) VALUES ('0012_tag_colors')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
