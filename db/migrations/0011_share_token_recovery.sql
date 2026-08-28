-- SONE 0011 — share links that can be shown again.
--
-- The original design stored only a hash, so a link shown once and then lost
-- had to be revoked and replaced — and everyone holding the old one lost access
-- for no reason.
--
-- A password must not be recoverable by anyone: it is the person's own secret.
-- A share link is not. It is a capability the page's administrator issued, and
-- that administrator can mint another at will, so refusing to show them the one
-- they issued protects nothing.
--
-- Stored encrypted rather than in plaintext: a database dump on its own must
-- not yield working links. Read-only SQL access — a reporting user, a replica,
-- a backup on a shared disk — would otherwise be escalated into write access
-- through an editable link. The key is derived from SONE_SECRET_KEY, which is
-- in the environment and not in here.
--
-- Nullable, and stays null for every link created before this migration. Those
-- cannot be shown again; the interface says so and offers to replace them,
-- which is what it had to do for all of them until now.

BEGIN;

ALTER TABLE share_tokens
  ADD COLUMN IF NOT EXISTS token_encrypted bytea;

COMMENT ON COLUMN share_tokens.token_encrypted IS
  'AES-256-GCM (nonce || ciphertext || tag) of the share token, under a key '
  'derived from SONE_SECRET_KEY. Null for links created before 0011, and for '
  'links whose plaintext was deliberately discarded. Never leaves the server '
  'except to somebody who administers the page.';

INSERT INTO schema_migrations (version) VALUES ('0011_share_token_recovery')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
