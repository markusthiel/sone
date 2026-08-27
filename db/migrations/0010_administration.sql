-- SONE 0010_administration
--
-- Two things an administrator needs that did not exist: someone to *be* the
-- administrator, and settings that can be changed without a redeploy.
--
-- ## Who administers the instance
--
-- Distinct from a workspace role. A workspace owner administers their own
-- workspace; an instance administrator can see that other workspaces exist, add
-- and remove accounts, and change how the instance behaves. Conflating the two
-- would mean anyone who creates a workspace — which anyone may do (ADR-0007) —
-- administers the server.
--
-- ## Settings that outlive a container
--
-- Configuration comes from the environment, which is right for anything that
-- must be known before the database is reachable: the database URL, the secret
-- key, the port. It is wrong for anything an administrator wants to change on a
-- Tuesday, because changing it means editing a compose file and restarting.
--
-- So: a settings table that overrides the environment for the few values where
-- that makes sense, and the environment as the default. Startup-critical values
-- deliberately stay environment-only — a database that will not open cannot
-- tell you how to open it.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_instance_admin boolean NOT NULL DEFAULT false;

-- Whoever set the instance up administers it. Without this the first
-- deployment has no administrator at all and no way to appoint one.
UPDATE users
   SET is_instance_admin = true
 WHERE id = (
   SELECT created_by FROM workspaces
    WHERE created_by IS NOT NULL
    ORDER BY created_at
    LIMIT 1
 );

-- Deactivation rather than deletion. Removing an account would cascade to every
-- page it created, and "this person has left" is not "their work never
-- happened". A deactivated account cannot sign in and keeps its authorship.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

CREATE INDEX IF NOT EXISTS users_admin_idx
  ON users (is_instance_admin) WHERE is_instance_admin;

CREATE TABLE IF NOT EXISTS instance_settings (
  key        text PRIMARY KEY,
  -- jsonb rather than text: a setting may be a string, a number or a flag, and
  -- storing everything as text means every reader parses it slightly
  -- differently.
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL
);

COMMENT ON TABLE instance_settings IS
  'Administrator-changeable settings, overriding the environment. Only for '
  'values that are safe to change while running: anything needed before the '
  'database opens stays environment-only.';

COMMENT ON COLUMN users.is_instance_admin IS
  'Administers the server, as opposed to a workspace. A workspace owner runs '
  'their workspace; an instance admin runs the instance.';

INSERT INTO schema_migrations (version) VALUES ('0010_administration')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
