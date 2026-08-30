-- SONE 0019 — restricting a page (ADR-0026).
--
-- `page_permissions` has existed since 0001 and `claims.ts` already reads it:
-- per-page grants for named people, with include_subtree deciding whether a
-- grant reaches descendants. A first draft of this migration created a second
-- table beside it and `IF NOT EXISTS` silently did nothing, which is exactly
-- how two tables for one idea come about.
--
-- So this adds only what was missing: a page that *withholds* access rather
-- than granting it.

BEGIN;

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN pages.restricted IS
  'When true, the workspace role no longer reaches this page or its '
  'descendants: only the workspace''s owners and admins and the people named '
  'in page_permissions do. When false, page_permissions only widen access '
  '(ADR-0026).';

-- Answering "which pages are restricted" while walking a tree.
CREATE INDEX IF NOT EXISTS pages_restricted_idx
  ON pages (workspace_id)
  WHERE restricted;

INSERT INTO schema_migrations (version) VALUES ('0019_page_permissions')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
