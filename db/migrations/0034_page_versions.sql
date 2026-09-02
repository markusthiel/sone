-- What a page said, at moments worth keeping (ADR-0047).
--
-- Kept deliberately rather than derived from the update log: `compactDoc` folds
-- the log into one state and deletes what it folded in (ADR-0002), so the log
-- reaches back to the last compaction and no further. A history built on it
-- would silently end minutes ago, which is worse than none because somebody
-- would trust it.
CREATE TABLE IF NOT EXISTS page_versions (
  id           bigserial PRIMARY KEY,
  doc_id       uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  -- The update sequence this state includes. Two versions of the same sequence
  -- are the same moment, so the pair is unique.
  through_seq  bigint NOT NULL,
  -- The document as it stood, encoded the same way the compaction snapshot is.
  state        bytea NOT NULL,
  taken_at     timestamptz NOT NULL DEFAULT now(),
  -- Who had written since the previous version. Text rather than a reference:
  -- a guest has no row in users (ADR-0022) and somebody who leaves still wrote.
  authors      text[] NOT NULL DEFAULT '{}',
  -- Why it exists, which decides what may be thinned away first.
  reason       text NOT NULL DEFAULT 'quiet'
    CHECK (reason IN ('quiet', 'compaction', 'restore')),
  UNIQUE (doc_id, through_seq)
);

CREATE INDEX IF NOT EXISTS page_versions_doc_idx
  ON page_versions (doc_id, taken_at DESC);
