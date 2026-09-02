-- The words a workspace's pages contain, for suggesting a correction
-- (ADR-0051).
--
-- A word list rather than trigrams over the block text, decided from a
-- measurement: 0.5 ms against 14.4 ms on a corpus of 4000 blocks, and — the
-- real reason — this yields the *correction* rather than the match, so the
-- ordinary ranked search can then run for the corrected word with its own
-- weighting, snippets and dictionary.
--
-- No page ids in here, deliberately. A suggestion has no business knowing which
-- page a word came from: the ordinary search answers that with the workspace's
-- visibility rules applied, and a table that could say "this word is on a page
-- you may not read" would be a way around them.
BEGIN;

CREATE TABLE IF NOT EXISTS workspace_words (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- Lowercased on the way in: a suggestion is matched case-insensitively and
  -- storing both cases would double the table to no purpose.
  word         text NOT NULL,
  PRIMARY KEY (workspace_id, word)
);

-- The trigram index the measurement was about.
CREATE INDEX IF NOT EXISTS workspace_words_trgm_idx
  ON workspace_words USING gin (word gin_trgm_ops);

INSERT INTO schema_migrations (version) VALUES ('0038_workspace_words')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
