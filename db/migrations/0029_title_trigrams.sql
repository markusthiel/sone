-- SONE 0029 — a misspelled search finds names (ADR-0036).
--
-- Trigram similarity on titles only. A typo happens while looking for a thing,
-- and a thing is found by its name; the body of a page is where somebody looks
-- for a phrase they remember, and they remember it correctly or not at all.
-- Indexing every block's text for trigrams would be the largest index in this
-- schema by a wide margin, for the rarer half of the case.

BEGIN;

-- Ships with Postgres, like pgcrypto, which this schema has required since 0001.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN rather than GiST: the query is a similarity lookup and never a nearest-
-- neighbour ordering, and GIN answers the first faster.
CREATE INDEX IF NOT EXISTS pages_title_trgm_idx
  ON pages USING gin (title gin_trgm_ops);

COMMENT ON INDEX pages_title_trgm_idx IS
  'Serves word_similarity() on a title, for the suggestions a misspelled search '
  'gets instead of nothing. Separate from page_search.tsv on purpose: full text '
  'ranks what matched, this measures what is close, and the two are never mixed '
  'into one list (ADR-0036).';

INSERT INTO schema_migrations (version) VALUES ('0029_title_trigrams')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
