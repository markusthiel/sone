-- SONE 0025 — an image is kept twice (ADR-0029).
--
-- The original as uploaded, and a web version bounded on the long edge. The
-- page displays the web version; "Download the original" gives the other.
--
-- The relationship lives here rather than in the block that shows the image: a
-- block holding both ids is a block that can lose one, and an image copied into
-- another page would carry a reference to a variant nobody can find.

BEGIN;

CREATE TYPE file_variant AS ENUM ('original', 'web', 'avatar');

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS variant file_variant NOT NULL DEFAULT 'original',
  ADD COLUMN IF NOT EXISTS variant_of uuid REFERENCES files (id) ON DELETE CASCADE;

COMMENT ON COLUMN files.variant IS
  'What this file is: the upload as sent, a bounded copy for display, or a '
  'profile picture. Everything uploaded before this migration is an original '
  'with no variant, which is the same as an image too small to need one '
  '(ADR-0029).';

COMMENT ON COLUMN files.variant_of IS
  'The original this was made from. Null for an original. On delete cascade, '
  'because a variant without its original is a file nothing can name.';

-- Finding an image's web version, which happens on every page that shows one.
CREATE INDEX IF NOT EXISTS files_variant_of_idx
  ON files (variant_of)
  WHERE variant_of IS NOT NULL;

-- A variant is not an orphan.
--
-- The sweep looks for files no block refers to; a web version is referred to by
-- its original rather than by a block, so without this it would be collected on
-- the first pass after being made.
COMMENT ON TYPE file_variant IS
  'Checked by the orphan sweep: a row with variant_of set is reachable through '
  'its original and must not be collected on its own.';

INSERT INTO schema_migrations (version) VALUES ('0025_image_variants')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
