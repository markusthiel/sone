-- SONE 0078 — a device to wake.
--
-- Notifications have been rows since ADR-0052 and mail since ADR-0061, and both
-- reach somebody who is looking. A push reaches somebody who is not: the browser
-- is closed, the iPad is on a table, and the thing that was asked for is a
-- notification like every other application's.
--
-- ## Two tables, because they are two different secrets
--
-- `push_identity` is how this instance signs itself to Apple's and Google's push
-- services — one keypair for the whole instance, generated on first use so a
-- self-hosted upgrade stays "pull and restart, nothing else" (ADR-0013).
--
-- Deliberately **not** `instance_settings`, whose own comment scopes it to
-- "administrator-changeable settings": a private key is not a setting, and a
-- table an administration screen reads is not where one belongs.
--
-- `push_subscriptions` is one row per device somebody has switched on. The
-- endpoint is the primary key because it is what the push service gave out and
-- what identifies the device — two people can never share one, and the same
-- browser re-subscribing gets the same row back.
--
-- ## Why no encryption keys are stored
--
-- A push here carries **no payload**. The service worker is woken and asks this
-- server what happened, over the session it already has.
--
-- That is the smaller implementation — RFC 8291's payload encryption is not
-- needed at all, only RFC 8292's signature — and it is the better one for this
-- application: nothing about a page, a comment or a person passes through a
-- third party's push service. The subscription's `p256dh` and `auth` keys exist
-- only to encrypt a payload, so they are never asked for and never kept.
--
-- ## Failures are counted, not guessed at
--
-- A push service answers 404 or 410 for an endpoint that is gone, and that row
-- is deleted on the spot. Anything else — a 500, a timeout — is counted, so a
-- device that has been unreachable for a long run can be dropped later without
-- mistaking one bad afternoon for a deleted browser.

BEGIN;

CREATE TABLE push_identity (
  -- One row, and the column exists to say so.
  only_row    boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  -- The uncompressed P-256 point, base64url — what a browser is handed as
  -- `applicationServerKey` when it subscribes.
  public_key  text NOT NULL,
  -- The private half, as a JWK. Never leaves this server and is not readable
  -- through any route.
  private_key jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE push_identity IS
  'The instance''s VAPID keypair, generated on first use (ADR-0180).';

CREATE TABLE push_subscriptions (
  endpoint   text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- When this endpoint last accepted a push, for telling a quiet device from a
  -- broken one.
  last_ok_at timestamptz,
  failures   integer NOT NULL DEFAULT 0
);

-- Read by person, which is the only question asked of it: wake this one's
-- devices.
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

COMMENT ON TABLE push_subscriptions IS
  'One row per device somebody switched notifications on for (ADR-0180).';

INSERT INTO schema_migrations (version) VALUES ('0078_a_device_to_wake');

COMMIT;
