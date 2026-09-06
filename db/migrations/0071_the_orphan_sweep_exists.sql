-- SONE 0071 — correct a comment that promised a mechanism (ADR-0109).
--
-- `db/migrations/0025` has said this about `file_variant` since it was written:
--
--   'Checked by the orphan sweep: a row with variant_of set is reachable
--    through its original and must not be collected on its own.'
--
-- There was no orphan sweep. ADR-0080 counted three places in the codebase
-- referring to one — `files/routes.ts`, the purge, and `backup.ts` — corrected
-- two of them and left this one, which is the only one written into the schema
-- where a person reading the database would find it.
--
-- There is a sweep now, and the comment is still wrong, which is the
-- interesting part. It describes a sweep over **rows**: files no block refers
-- to. What exists is a sweep over **bytes**: objects in storage that no row
-- names. A variant is safe under it for a reason that has nothing to do with
-- being reachable through its original — it has a row of its own, like
-- everything else.
--
-- Corrected rather than deleted: the sentence is the record of what somebody
-- expected, and the next person to consider a row-level sweep should find out
-- here that a byte-level one already exists.
BEGIN;

COMMENT ON TYPE file_variant IS
  'What a file is: the upload as sent, a bounded copy for display, or a '
  'profile picture (ADR-0029). '
  'The orphan sweep is over storage keys rather than rows (ADR-0109), so a '
  'variant is kept because its own row names its key — not because it is '
  'reachable through its original, which is what this comment claimed while no '
  'sweep of any kind existed.';

INSERT INTO schema_migrations (version) VALUES ('0071_the_orphan_sweep_exists')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
