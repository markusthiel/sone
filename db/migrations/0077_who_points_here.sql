-- SONE 0077 — which pages point at this one.
--
-- The links panel has been able to say *what does this page link to* since
-- ADR-0158, and it reads the open document to do it. The other direction cannot
-- be answered that way at all: the pages that point **here** are documents
-- nobody has open, and asking would mean opening every document in the
-- workspace on every panel render.
--
-- So it is a projection, written by the materialiser from the document — for
-- the reason mentions are read from the document rather than trusted from a
-- client: a link a client reports is a link a client can forge.
--
-- ## Why no foreign key to pages
--
-- The same argument `page_tags` makes. Updates arrive in whatever order the
-- sync rooms flush them, so a page can link to one that has not been
-- materialised yet — during an import, or simply because the other room
-- flushed second. A foreign key would refuse the row and take the whole
-- projection down with it.
--
-- The materialiser filters unresolvable targets instead, the way
-- `page_relations` does, and the next projection of the source page picks them
-- up. What is left behind by a *deleted* target is a row whose join finds
-- nothing, which is invisible rather than wrong.
--
-- ## Why the block is here twice
--
-- `from_block_id` is what makes the row stable: one link per target per block,
-- so editing the words around a link does not make it a different link. It is
-- also what lets the panel offer *show me where* — the same jump the outline
-- and the links panel already make.
--
-- `to_block_id` is the fragment, and it is nullable because most links name a
-- page rather than a passage. Nothing reads it yet. It is here because the
-- extractor already parses it and a column costs a line now against a migration
-- later.
--
-- ## Why the primary key is the triple
--
-- A page may link to the same target from several blocks, and each is a
-- separate place to be shown. Two links to one target *from one block* are one
-- reference, which the extractor already collapses — this states the same rule
-- where the rows live.

BEGIN;

CREATE TABLE page_links (
  -- The page whose document contains the link.
  from_page_id  uuid NOT NULL,
  -- The block within it, so the panel can point at the sentence.
  from_block_id text NOT NULL,
  -- The page it points at.
  to_page_id    uuid NOT NULL,
  -- And the block, when the address named one.
  to_block_id   text,
  PRIMARY KEY (from_page_id, from_block_id, to_page_id)
);

-- Deleted and rewritten per source page on every projection, which is the whole
-- lifecycle of a row here.
CREATE INDEX page_links_from_idx ON page_links (from_page_id);
-- And read by target, which is the question the panel asks.
CREATE INDEX page_links_to_idx ON page_links (to_page_id);

COMMENT ON TABLE page_links IS
  'One row per page-to-page link per block, read from the document (ADR-0174).';

INSERT INTO schema_migrations (version) VALUES ('0077_who_points_here');

COMMIT;
