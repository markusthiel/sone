-- Resetting a forgotten password (ADR-0059).
--
-- Not the table `0004_auth` created and `0046` dropped: that one was written
-- years before there was a mail path to use it, and its shape was a guess. This
-- one follows a record.
--
-- The token is stored **hashed**, the rule sessions already follow (ADR-0010):
-- the server keeps the plaintext of nothing that grants access, so a stolen
-- backup contains no working links.
BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  -- SHA-256 of the token, as hex. The token itself exists only in the mail.
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- Set when a password was actually changed with it. One use, and consumed on
  -- success only: a wrong new password must not burn the link, or somebody who
  -- mistypes has to start again from the mail.
  used_at    timestamptz
);

-- The only query that matters besides the lookup: clearing what has expired.
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx
  ON password_reset_tokens (expires_at)
  WHERE used_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('0047_password_reset')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
