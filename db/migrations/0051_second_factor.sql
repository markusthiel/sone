-- A second factor, and the codes that get somebody back in (ADR-0063).
--
-- One row per account, because TOTP is one shared secret and a second
-- authenticator app is the same secret scanned twice. Passkeys will want many
-- rows per account, which is one of the reasons they are a separate decision.
--
-- confirmed_at is what makes enrolment safe: the secret exists from the moment
-- it is shown, and it does not count until a code has been proved against it.
-- Somebody who mis-scans, or whose phone clock is wrong, is not locked out of
-- their own account by a QR code they never got to test.
--
-- last_step stops a code being used twice inside its window: whoever read it
-- over a shoulder gets nothing.
BEGIN;

CREATE TABLE IF NOT EXISTS second_factors (
  user_id      uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- AES-256-GCM under a key derived from SONE_SECRET_KEY. Encrypted rather than
  -- hashed because a code has to be checked against it.
  secret       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  last_step    bigint
);

CREATE TABLE IF NOT EXISTS recovery_codes (
  -- The hash is the identity: two accounts cannot share one, and the plaintext
  -- exists on the screen it was shown on and nowhere else.
  code_hash text PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  used_at   timestamptz
);

CREATE INDEX IF NOT EXISTS recovery_codes_user_idx
  ON recovery_codes (user_id) WHERE used_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('0051_second_factor')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
