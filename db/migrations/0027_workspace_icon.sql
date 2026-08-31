-- SONE 0027 — a workspace looks like something (ADR-0030).
--
-- The same shape `pages.icon` holds: an icon name from the Lucide set, a colour
-- for the icon and a separate one for the text. Same shape on purpose —
-- somebody who has decorated a folder has already learnt this, and a second
-- similar system would mean learning it twice and being surprised by the
-- differences.

BEGIN;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS icon jsonb;

COMMENT ON COLUMN workspaces.icon IS
  'How this workspace is recognised in a list: {icon, iconColor, titleColor}, '
  'the same shape as pages.icon. Deliberately not part of the workspace theme, '
  'which is about how content looks to everybody reading it — a switcher that '
  'changed because somebody adjusted a heading colour would be two unrelated '
  'things sharing a name (ADR-0030).';

INSERT INTO schema_migrations (version) VALUES ('0027_workspace_icon')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
