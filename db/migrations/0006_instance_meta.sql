-- SONE 0006_instance_meta
--
-- Records which version of SONE last ran against this database, so an upgrade
-- can be checked rather than hoped for.
--
-- Three failure modes this exists to catch, all of which are otherwise silent
-- and all of which corrupt data:
--
-- 1. Downgrade. Older code against a newer database sees columns it does not
--    know and, worse, documents at a schema version it cannot read. Postgres
--    would happily serve it.
--
-- 2. Version skip. Some future migration will need data that a later migration
--    removes, making a jump from an old version to a much newer one invalid
--    even though each individual migration is valid SQL. The recorded version
--    is what lets the server say "upgrade to 2.x first".
--
-- 3. Two different versions running against one database, which happens during
--    a botched rolling deploy and produces documents in mixed formats.

BEGIN;

CREATE TABLE instance_meta (
  -- Single row, enforced by the check. A table rather than a settings key-value
  -- store because these fields are queried on every start and typed.
  id                       boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Application version that most recently started successfully.
  app_version              text        NOT NULL,
  -- Highest document schema version this instance is capable of.
  document_schema_version  integer     NOT NULL,
  -- Lowest app version that may run against this database. Raised by a
  -- migration that makes an older version unsafe, which is how a version skip
  -- is refused with a useful message instead of a crash.
  min_app_version          text        NOT NULL DEFAULT '0.0.0',
  instance_id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  first_started_at         timestamptz NOT NULL DEFAULT now(),
  last_started_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE instance_meta IS
  'One row. Written on every successful start; read before serving traffic to refuse downgrades and invalid version skips.';

COMMENT ON COLUMN instance_meta.min_app_version IS
  'Raised by a migration that makes older application versions unsafe. The server refuses to start below it.';

-- ---------------------------------------------------------------------------
-- Document schema census
-- ---------------------------------------------------------------------------

-- Documents are migrated lazily on open, so at any moment a database may hold
-- several schema versions. That is normal and correct — but it must be
-- observable, both to answer "is the migration finished?" and because an
-- unopened document stays at its old version indefinitely.
CREATE VIEW document_schema_census AS
  SELECT p.workspace_id,
         p.schema_version,
         count(*) AS pages,
         min(p.last_edited_at) AS oldest_edit,
         max(p.last_edited_at) AS newest_edit
    FROM pages p
   GROUP BY p.workspace_id, p.schema_version;

COMMENT ON VIEW document_schema_census IS
  'Pages per document schema version. Rows below the current version are documents not yet opened since the upgrade; they migrate on next open.';

INSERT INTO schema_migrations (version) VALUES ('0006_instance_meta');

COMMIT;
