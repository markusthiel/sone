-- SONE 0070 — name the content earlier purges left behind (ADR-0106).
--
-- ADR-0080 stopped the leak: purging a deleted workspace cascaded to `pages`
-- and stopped there, so every byte of every page in it stayed in the database
-- forever. Its own consequences section named what it did not do:
--
--   'An instance that has ever purged a workspace still holds its content.
--    This change stops it happening again; it does not clean up what is
--    already there, and nothing in this release does. […] a sweep for them is
--    a query over `doc_updates` with no join available — it would have to work
--    from "doc_id matches no page and no page's internal document", which is
--    exactly the shape of query that is one mistake away from deleting live
--    data.'
--
-- The join is available. It just has to be built, and the reason it looked
-- unavailable is that half of it is a hash.
--
-- ## Two kinds of document, one of them derived
--
-- A `doc_id` is either a page's id, or the id of that page's *internal*
-- comments document (ADR-0057) — a UUIDv5 derived from the page id rather than
-- stored, so that nothing has to be kept in step and no row can go missing
-- while its updates remain. Nothing else writes to these tables.
--
-- Derived means one-way: given a stray `doc_id` you cannot ask which page it
-- came from. But you can go the other way, and that is enough — the set of
-- legitimate ids is exactly `{page id} ∪ {internal_doc_id(page id)}` over the
-- pages that exist.
--
-- ## Why the derivation is written twice, on purpose
--
-- `internalDocId` in `@sone/core` is the statement of this rule, and
-- `deleteDocuments.ts` says out loud that re-deriving it elsewhere would be a
-- second implementation. This is one — and it is the same trade ADR-0080 made
-- for `retryDelayMs`:
--
--   '`retryDelayMs` stays, as the readable statement of the rule, and a test
--    binds it to the SQL that ships. Deleting it would leave the query
--    unchecked; keeping it unbound was worse than either.'
--
-- So: a test computes both for a set of ids and asserts they agree. Two
-- implementations bound by a test are not two answers; two implementations
-- nobody compares are.
BEGIN;

/*
 * UUIDv5 over the namespace `internalDocId` uses, by hand, exactly as the
 * TypeScript does it: sha1 of the namespace bytes followed by the page id's
 * text, first sixteen bytes, then the version and variant bits.
 *
 * `IMMUTABLE` because it is a pure function of its argument — which is what
 * lets the planner hash it once per page in the view below rather than once per
 * comparison.
 */
CREATE OR REPLACE FUNCTION internal_doc_id(page uuid) RETURNS uuid AS $$
DECLARE
  digest_bytes bytea;
  out_bytes    bytea;
BEGIN
  digest_bytes := digest(
    decode(replace('6f9f6b1e-4a4a-5f6c-8f2e-1d3c5b7a9e01', '-', ''), 'hex')
      || convert_to(page::text, 'UTF8'),
    'sha1'
  );
  out_bytes := substring(digest_bytes from 1 for 16);
  -- Version 5 and the RFC 4122 variant. Without these two lines the result is a
  -- hash rather than a uuid, and the column would refuse it.
  out_bytes := set_byte(out_bytes, 6, (get_byte(out_bytes, 6) & 15) | 80);
  out_bytes := set_byte(out_bytes, 8, (get_byte(out_bytes, 8) & 63) | 128);
  RETURN encode(out_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

COMMENT ON FUNCTION internal_doc_id(uuid) IS
  'Where a page''s internal comments live (ADR-0057). Mirrors internalDocId in '
  '@sone/core, which is the statement of the rule; a test binds the two '
  '(ADR-0106).';

/*
 * Documents belonging to no page.
 *
 * An anti-join against the whole legitimate set rather than two correlated
 * `NOT EXISTS`, which would re-scan `pages` once per document.
 *
 * `last_written` is the newest write across both tables, and it is the point of
 * the view rather than a decoration: **a document with no page is not
 * necessarily an orphan.** `createEntry` appends the first update and
 * materialises the page in a *separate* transaction, so between those two
 * statements a live document has no row — and if the materialisation fails, it
 * has none for good. Every caller of this view is expected to apply an age
 * condition, exactly as the `orphaned_pages` and `pages_inside_pages` counts
 * do, and for the same reason.
 */
CREATE OR REPLACE VIEW orphaned_documents AS
  WITH live AS (
    SELECT id AS doc_id FROM pages
    UNION ALL
    SELECT internal_doc_id(id) FROM pages
  ),
  written AS (
    SELECT doc_id, created_at AS written_at FROM doc_updates
    UNION ALL
    SELECT doc_id, updated_at FROM doc_snapshots
  )
  SELECT w.doc_id, max(w.written_at) AS last_written
    FROM written w
    LEFT JOIN live ON live.doc_id = w.doc_id
   WHERE live.doc_id IS NULL
   GROUP BY w.doc_id;

COMMENT ON VIEW orphaned_documents IS
  'CRDT documents belonging to no page: content left behind by a purge from '
  'before ADR-0080, or by a page creation that failed between its first update '
  'and its materialisation. Ask with an age condition — a document seconds old '
  'may simply be arriving before its page (ADR-0106).';

INSERT INTO schema_migrations (version) VALUES ('0070_orphaned_documents')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
