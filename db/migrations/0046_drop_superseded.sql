-- Two things the schema promised and nothing kept.
--
-- Found by asking the reverse of the usual question. There is a check that every
-- column the code names exists; this came from asking which columns exist that
-- the code never names — and both of these are lies in the schema rather than
-- merely unused space: somebody reading it would take them for features.
--
-- `users.avatar_url` has been there since 0001_init and was superseded by
-- 0026_avatar, which added `avatar_key` and `avatar_mime` and did not drop it.
-- Nothing has written it since, and nothing ever read it.
--
-- `password_resets` is a whole table, created in 0004_auth, that no line of
-- server code touches: no route issues a token, none consumes one, and its
-- `used_at` index guards a column nothing sets. A table shaped like a security
-- feature that does not exist is worse than an absent one — the next person to
-- read the schema would reasonably conclude that resets are handled.
--
-- Kept in mind rather than kept: a password reset by email is now *possible*
-- for the first time, since ADR-0058 gave the server a mail path. When it is
-- built it will want a token shape decided on purpose, and a table waiting since
-- 0004 is not that decision.
BEGIN;

ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;

DROP TABLE IF EXISTS password_resets;

INSERT INTO schema_migrations (version) VALUES ('0046_drop_superseded')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
