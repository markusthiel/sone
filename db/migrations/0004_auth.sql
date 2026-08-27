-- SONE 0004_auth
--
-- Server-side sessions rather than stateless tokens. ADR-0006 rejected JWTs
-- for share links because revoking a leaked link must take effect
-- immediately; the same argument applies to sessions, and having one
-- mechanism instead of two is worth more than the scale a self-hosted
-- instance will never reach.
--
-- Only hashes are stored. A leaked database must not yield usable
-- credentials, so every token column here holds a digest and the plaintext
-- exists exactly once, in the response that created it.

BEGIN;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 of the session token. Random 256-bit tokens need no salt or KDF:
  -- there is no low-entropy secret to protect against offline guessing.
  token_hash    bytea NOT NULL UNIQUE,
  -- Coarse client description for the "active sessions" list. Not a
  -- fingerprint: truncated and never used for authentication decisions.
  user_agent    text,
  ip_prefix     inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);

CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

CREATE TABLE invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- Null for a link-style invitation that anyone holding the URL may accept.
  email         text,
  role          workspace_role NOT NULL DEFAULT 'member',
  token_hash    bytea NOT NULL UNIQUE,
  -- Link invitations may be used more than once; email invitations once.
  max_uses      integer NOT NULL DEFAULT 1,
  uses          integer NOT NULL DEFAULT 0,
  invited_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  CONSTRAINT invitations_uses_within_limit CHECK (uses <= max_uses)
);

CREATE INDEX invitations_workspace_idx ON invitations (workspace_id)
  WHERE revoked_at IS NULL;
CREATE INDEX invitations_email_idx ON invitations (lower(email))
  WHERE email IS NOT NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Password reset
-- ---------------------------------------------------------------------------

CREATE TABLE password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

CREATE INDEX password_resets_user_idx ON password_resets (user_id) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

-- Login and share-link attempts, counted per identifier. In Postgres rather
-- than in memory so the limit holds across instances and across restarts —
-- an in-memory counter is defeated by restarting the container.
CREATE TABLE auth_attempts (
  -- 'login:<email>', 'share:<token prefix>', 'reset:<email>'
  key         text        NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  succeeded   boolean     NOT NULL,
  ip_prefix   inet
);

CREATE INDEX auth_attempts_key_idx ON auth_attempts (key, attempted_at DESC);

-- Retention: attempts older than a day carry no signal and should not grow
-- without bound. Deleted by the maintenance job, not by a trigger.
COMMENT ON TABLE auth_attempts IS
  'Rate-limit ledger. Rows older than 24h are deleted by the maintenance job.';

INSERT INTO schema_migrations (version) VALUES ('0004_auth');

COMMIT;
