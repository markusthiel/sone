-- A page locked against accidental editing (ADR-0049).
--
-- The document is where the flag lives, because a lock has to reach another
-- person's *open* editor and a projection would arrive on their next reload.
-- This column exists so the tree can draw a padlock without opening every
-- document.
--
-- Not a permission. Anybody who may edit the page may lift it; what restricts
-- other people is a page permission (ADR-0026).
BEGIN;

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version) VALUES ('0036_page_locked')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
