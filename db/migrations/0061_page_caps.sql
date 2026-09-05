-- SONE 0061 — a ceiling on a page (ADR-0087, step four).
--
-- The third and last layer of the precedence rule, and the only one that can
-- take something away:
--
--   1. The role's page level is the base.
--   2. Grants widen it. Never lower — a group must not be able to demote
--      somebody by admitting them (ADR-0026).
--   3. A cap lowers it, for a page and its subtree, and beats everything.
--
-- What makes a cap different from a grant is what it is attached to. A grant
-- names a *person* or a *group*; a cap names a **page**. That is why it can
-- lower without reopening the question ADR-0026 settled: a cap cannot travel
-- with a group membership, so joining a group still never costs anybody
-- anything.
--
-- The case it exists for: "this section is reference material, nobody edits
-- it", said once, instead of removing everybody's grant one at a time and
-- doing it again for every person added afterwards.

BEGIN;

-- One cap per page. Two would be two answers to one question, and the screen
-- would have to pick between them; the primary key says which is impossible.
--
-- Where several apply through ancestry, the **lowest** wins. A ceiling under a
-- ceiling is the real ceiling, and the alternative — the nearest one wins —
-- would let a subpage quietly undo a restriction set on the section above it.
CREATE TABLE IF NOT EXISTS page_caps (
  page_id         uuid PRIMARY KEY REFERENCES pages (id) ON DELETE CASCADE,

  -- The most anybody gets here, whatever their role or grants say.
  --
  -- `share_role` again, and deliberately not nullable: there is no 'nothing'
  -- level, so a cap can never hide a page. That is a feature rather than an
  -- omission — a page that vanished for a reason the reader cannot see is the
  -- thing ADR-0026 spends its length avoiding, and hiding a page is what
  -- `pages.restricted` is for.
  max_level       share_role NOT NULL,

  include_subtree boolean NOT NULL DEFAULT true,
  set_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  set_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE page_caps IS
  'A ceiling on what a page gives, for it and optionally its subtree. Applied '
  'after the role and any grants, and it lowers where those only widen. Does '
  'not apply to somebody whose workspace role makes them a page admin, or a '
  'cap could lock out the people who have to be able to lift it (ADR-0087).';

INSERT INTO schema_migrations (version) VALUES ('0061_page_caps')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
