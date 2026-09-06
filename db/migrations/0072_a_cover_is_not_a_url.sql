-- SONE 0072 — `pages.cover_url text` becomes `pages.cover jsonb` (ADR-0117).
--
-- The column has been here since 0001, alongside `icon jsonb`, and has never
-- held a value: the projection read `PAGE_KEYS.coverUrl` out of the document
-- and the page route handed it to the browser, but nothing in SONE has ever
-- written one. The same history `icon` had before ADR-0030 filled it in.
--
-- A cover is now a picture, a colour or a gradient, and two of those three are
-- not URLs. `text` can hold only one third of the answer, and a projection that
-- holds a third of the answer is worse than one that holds none — the folder
-- view reads this column to draw the cover, and a folder whose cover is a
-- colour would have drawn nothing while the page beside it drew the picture.
--
-- ## The guard, and why it is not decoration
--
-- Dropping a column on the strength of "nothing writes it" is exactly the claim
-- migration 0069 found to be false the day it was written:
--
--   'Nothing reads it' was false the day it was written. /api/auth/session and
--   /api/workspaces both selected m.role ...
--
-- So this does not take my word for it. Every instance checks its own data
-- before the column goes, and an instance that disagrees stops the deployment
-- with the count in the message rather than losing something quietly. If that
-- ever fires, the value is still there to look at: the transaction rolls back.

BEGIN;

DO $$
DECLARE
  covered bigint;
BEGIN
  SELECT count(*) INTO covered FROM pages WHERE cover_url IS NOT NULL;
  IF covered > 0 THEN
    RAISE EXCEPTION
      'pages.cover_url holds % row(s); ADR-0117 assumed none. Nothing in SONE '
      'has ever written this column, so these came from somewhere else and are '
      'not mine to drop. Copy them out, then re-run.', covered;
  END IF;
END $$;

ALTER TABLE pages DROP COLUMN cover_url;

-- Beside `icon`, and the same type, because it is the same kind of thing: a
-- small object the document owns and the projection carries so the tree can
-- draw an entry without opening it.
ALTER TABLE pages ADD COLUMN cover jsonb;

INSERT INTO schema_migrations (version) VALUES ('0072_a_cover_is_not_a_url');

COMMIT;
