-- SONE 0005_i18n
--
-- Internationalisation touches the schema in three places, and all three are
-- cheaper to decide now than after documents exist.
--
-- 1. Per-user locale and timezone. Notification emails and invitations must be
--    written in the *recipient's* language, which is not the language of the
--    request that triggered them. That means the locale has to be stored, not
--    read from an Accept-Language header.
--
-- 2. Per-workspace text search configuration. 0001 hardcoded
--    to_tsvector('simple', ...), which does no stemming: a search for
--    "Häuser" does not find "Haus", and "running" does not find "run". For a
--    German or French instance that is a visibly broken search.
--
-- 3. Collation for user-visible sorting. This one contradicts a decision in
--    0001 and is explained at length below.

BEGIN;

-- ---------------------------------------------------------------------------
-- User locale
-- ---------------------------------------------------------------------------

ALTER TABLE users
  -- BCP 47 tag. Null means "follow the browser", which is the right default
  -- for the UI but not for email — the mailer falls back to the workspace
  -- language and then to English.
  ADD COLUMN locale text,
  -- IANA zone name. Needed server-side for date-field grouping in calendar
  -- views: "this week" depends on where the reader is.
  ADD COLUMN timezone text,
  ADD CONSTRAINT users_locale_format
    CHECK (locale IS NULL OR locale ~ '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$');

-- ---------------------------------------------------------------------------
-- Workspace language and search configuration
-- ---------------------------------------------------------------------------

ALTER TABLE workspaces
  ADD COLUMN default_locale text NOT NULL DEFAULT 'en',
  -- A Postgres text search configuration name ('german', 'english',
  -- 'simple', ...). regconfig rather than text so a typo fails at write time
  -- instead of at query time.
  ADD COLUMN search_config regconfig NOT NULL DEFAULT 'simple',
  -- ICU collation for user-visible text sorting. See the note below.
  ADD COLUMN sort_collation text NOT NULL DEFAULT 'und-x-icu';

COMMENT ON COLUMN workspaces.search_config IS
  'Postgres text search configuration used when building page_search.tsv. Changing it requires re-materialising the workspace: rematerialize.mjs --workspace <id>';

-- ---------------------------------------------------------------------------
-- Collation: the conflict with 0001
-- ---------------------------------------------------------------------------

-- 0001 mandates the C collation for the whole database, and that is still
-- correct: fractional indices are compared byte-wise, and a locale-aware
-- database collation would silently reorder blocks. verifyDatabaseAssumptions
-- refuses to start otherwise.
--
-- But C collation is wrong for text a human reads. Under C, 'Äpfel' sorts
-- after 'Zwiebel' and 'ö' after 'z', so an alphabetical list of German page
-- titles comes out visibly wrong.
--
-- Resolution: the database collation stays C, and every query that sorts
-- USER-VISIBLE text applies an explicit COLLATE using the workspace's
-- sort_collation. Fractional indices and token comparisons never do.
--
-- The rule, stated so it can be checked in review:
--   ORDER BY idx            -> never COLLATE. Byte-wise is the requirement.
--   ORDER BY title, or any  -> always COLLATE with workspace.sort_collation.
--   text property value
--
-- These indexes support the collated sort so it does not degrade to a full
-- sort on every view. 'und-x-icu' is the language-neutral Unicode collation:
-- correct for most European languages and a defensible default when a
-- workspace holds mixed-language content.
CREATE INDEX pages_title_collated_idx
  ON pages (workspace_id, title COLLATE "und-x-icu")
  WHERE archived_at IS NULL;

CREATE INDEX page_properties_text_collated_idx
  ON page_properties (field_id, text_value COLLATE "und-x-icu");

-- ---------------------------------------------------------------------------
-- Search index
-- ---------------------------------------------------------------------------

-- The tsvector now carries lexemes from BOTH the workspace's configured
-- dictionary and 'simple':
--
--   to_tsvector('german', body) || to_tsvector('simple', body)
--
-- The stemmed lexemes give recall (Häuser finds Haus); the simple lexemes
-- give exactness and keep search working for content in a language the
-- configured dictionary does not cover, which is the normal case in a
-- multilingual workspace. Roughly doubles the index size for the body, which
-- is an acceptable trade for search that works in two languages at once.
--
-- Built by the materialiser rather than a generated column precisely because
-- the configuration is per-workspace and a generated column cannot depend on
-- another table.
COMMENT ON COLUMN page_search.tsv IS
  'Weighted tsvector: title at weight A, body at weight D, each indexed under both the workspace search_config and simple.';

-- Which configuration produced the stored vector. When it differs from the
-- workspace setting, the row is stale and needs re-materialising — visible
-- rather than silently wrong.
ALTER TABLE page_search
  ADD COLUMN built_with regconfig NOT NULL DEFAULT 'simple';

CREATE VIEW stale_search_rows AS
  SELECT ps.page_id, ps.workspace_id, ps.built_with, w.search_config AS expected
    FROM page_search ps
    JOIN workspaces w ON w.id = ps.workspace_id
   WHERE ps.built_with <> w.search_config;

COMMENT ON VIEW stale_search_rows IS
  'Pages whose search vector was built with a different configuration than the workspace now specifies. Fix with rematerialize.mjs --workspace <id>.';

INSERT INTO schema_migrations (version) VALUES ('0005_i18n');

COMMIT;
