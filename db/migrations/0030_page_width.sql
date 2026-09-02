-- How wide a page's writing is (ADR-0028 gave every page one measure; this
-- lets a page say otherwise).
--
-- A column on `pages` rather than an attribute inside the document: it decides
-- how the page is *drawn*, which the tree already needs to know before the
-- document has synced, and a page that reflows a second after opening is worse
-- than one that opens wide.
--
-- Nullable, meaning "whatever the reader's default is". Not a default of
-- 'column' written into every row: an instance that later changes its mind
-- about the default would have to distinguish rows nobody chose for from rows
-- somebody chose the old default for, and by then it cannot.
BEGIN;

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS width text
    CHECK (width IS NULL OR width IN ('column', 'full'));

INSERT INTO schema_migrations (version) VALUES ('0030_page_width')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
