-- SONE 0076 — the first time somebody signs in, and every unfamiliar one after.
--
-- The last two of the six mails proposed beside ADR-0121:
--
--   a sign-in from a device this account has not used before
--   a welcome, the first time somebody signs in at all
--
-- They turn out to be one question asked twice. "Is this browser new to this
-- account" answers both: the first time there is nothing to compare against,
-- and every time after there is.
--
-- ## Why this is not read off `sessions`
--
-- `sessions` already holds a `user_agent`, and the obvious implementation is to
-- ask whether any other live session has the same one. It is wrong in a way
-- that shows up months later: sessions expire and the maintenance job prunes
-- them, so a browser somebody uses every few weeks becomes "new" again, and the
-- mail that exists to make an intrusion visible becomes the mail everybody
-- filters.
--
-- A row here outlives the session it came from, which is the whole point.
--
-- ## What is stored, and what it is not
--
-- A **hash** of the user agent, per account. Not the string — there is nothing
-- to gain from being able to read it back, and this table would otherwise be a
-- list of what every person on the instance uses.
--
-- `sessions` says of its own copy: *"Not a fingerprint: truncated and never
-- used for authentication decisions."* That holds here too, and more narrowly:
-- nothing reads this table to decide whether a request is allowed. It decides
-- whether to send a courtesy mail, and an attacker who copies a user agent
-- defeats it — which is why it is a notice and not a control.
--
-- Cascades with the account, like everything else that is about a person.

BEGIN;

CREATE TABLE known_devices (
  user_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 of the user agent. A hash rather than the string: nothing needs to
  -- read it back, and the string would make this a list of what everybody uses.
  agent_hash    bytea       NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, agent_hash)
);

COMMENT ON TABLE known_devices IS
  'Browsers an account has signed in from, so an unfamiliar one can be '
  'mentioned once (ADR-0130). Never consulted for access decisions.';

INSERT INTO schema_migrations (version) VALUES ('0076_the_first_time_and_every_new_one');

COMMIT;
