-- SONE 0028 — the switcher's order is the person's own (ADR-0031).
--
-- A fractional index, as folders and favourites use, on the membership row —
-- which is precisely "this person, this workspace", and is what a per-person
-- order is about.
--
-- Nullable, and no backfill. Six places create a membership today and there will
-- be more; with NOT NULL each of them has to generate a key and the next one
-- written fails at insert, on the signup path. Nullable means no insert site
-- changes and a membership that was never placed simply sorts by name. The first
-- reorder writes keys for the whole list (ADR-0031).

BEGIN;

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS idx text;

COMMENT ON COLUMN workspace_members.idx IS
  'Where this workspace sits in this person''s switcher: a fractional index, '
  'compared byte-wise like every other idx in this schema, which is why the '
  'database is C collation. NULL means never placed, and sorts after every key '
  'by name — so a newly joined workspace appears at the bottom of an arranged '
  'list rather than in the middle of it (ADR-0031).';

INSERT INTO schema_migrations (version) VALUES ('0028_workspace_order')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
