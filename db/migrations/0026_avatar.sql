-- SONE 0026 — a profile picture (ADR-0029).
--
-- Stored beside the account rather than as a row in `files`: an attachment
-- belongs to a workspace and a page, and a face belongs to a person. Putting it
-- in `files` would mean inventing a workspace for it, and then deciding what
-- happens to somebody's picture when that workspace is deleted.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_key text,
  ADD COLUMN IF NOT EXISTS avatar_mime text;

COMMENT ON COLUMN users.avatar_key IS
  'Storage key of the profile picture, bounded to 512 pixels and square. No '
  'original is kept: it is drawn at 22 pixels, and keeping a face at full '
  'resolution because the code path existed is not a decision anybody made '
  '(ADR-0029).';

INSERT INTO schema_migrations (version) VALUES ('0026_avatar')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
