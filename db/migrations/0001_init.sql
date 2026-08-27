-- SONE 0001_init
--
-- Two layers live in this schema and the distinction matters:
--
--   TRUTH        doc_updates / doc_snapshots. Append-only CRDT byte streams.
--                Nothing else may be treated as authoritative.
--   MATERIALISED everything else. Derived from the CRDTs by the sync server
--                after each commit. Fully rebuildable, and therefore safe to
--                change shape in later migrations without touching user data.
--
-- If you ever find yourself writing to a materialised table from anywhere but
-- the materialiser, stop: that is the bug that ends local-first correctness.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Plain text, not citext: case is folded in the application so the schema
  -- needs no extra extension.
  email         text,
  display_name  text        NOT NULL,
  avatar_url    text,
  password_hash text,
  -- Guests have no workspace membership but do have an account, so that a
  -- shared page can name who made a change.
  is_guest      boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz
);

CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE workspaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  icon       jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users (id) ON DELETE SET NULL
);

CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member', 'guest');

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         workspace_role NOT NULL DEFAULT 'member',
  joined_at    timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);

-- No seat limit exists anywhere in this schema, and none may be added.
-- See ADR-0007.

-- ---------------------------------------------------------------------------
-- Truth layer: CRDT storage
-- ---------------------------------------------------------------------------

-- One row per Yjs update. Append-only. The sync server compacts a run of
-- updates into a snapshot and deletes the compacted rows in one transaction.
CREATE TABLE doc_updates (
  doc_id     uuid   NOT NULL,
  seq        bigint NOT NULL,
  payload    bytea  NOT NULL,
  -- Who produced it. Null for anonymous share-link sessions.
  actor_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, seq)
);

CREATE SEQUENCE doc_update_seq;

-- A snapshot is the merged state up to and including `through_seq`.
CREATE TABLE doc_snapshots (
  doc_id      uuid   PRIMARY KEY,
  through_seq bigint NOT NULL,
  state       bytea  NOT NULL,
  -- Yjs state vector, so a reconnecting client can be sent a delta.
  state_vector bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Materialised layer: pages
-- ---------------------------------------------------------------------------

CREATE TABLE pages (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  parent_page_id uuid REFERENCES pages (id) ON DELETE CASCADE,
  -- Set when this page is a row of a collection. A collection row is a full
  -- page, not a lesser kind of object.
  collection_id  uuid,
  -- Fractional index, lexicographic sort among siblings.
  idx            text NOT NULL,
  title          text NOT NULL DEFAULT '',
  icon           jsonb,
  cover_url      text,
  schema_version integer NOT NULL DEFAULT 1,
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  last_edited_at timestamptz NOT NULL DEFAULT now(),
  last_edited_by uuid REFERENCES users (id) ON DELETE SET NULL,
  -- Denormalised ancestor path (root first, excluding self). Makes subtree
  -- permission checks a single indexed containment test instead of a
  -- recursive CTE on every document open.
  ancestor_ids   uuid[] NOT NULL DEFAULT '{}'
);

CREATE INDEX pages_workspace_idx      ON pages (workspace_id) WHERE archived_at IS NULL;
CREATE INDEX pages_parent_idx         ON pages (parent_page_id, idx);
CREATE INDEX pages_collection_idx     ON pages (collection_id) WHERE collection_id IS NOT NULL;
CREATE INDEX pages_ancestors_idx      ON pages USING gin (ancestor_ids);

-- ---------------------------------------------------------------------------
-- Materialised layer: blocks
-- ---------------------------------------------------------------------------

CREATE TABLE blocks (
  id         uuid PRIMARY KEY,
  page_id    uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES blocks (id) ON DELETE CASCADE,
  type       text NOT NULL,
  idx        text NOT NULL,
  props      jsonb NOT NULL DEFAULT '{}',
  -- Plain-text projection for search. Written by the block type's
  -- toPlainText(); never read back into the CRDT.
  plain_text text NOT NULL DEFAULT ''
);

CREATE INDEX blocks_page_idx   ON blocks (page_id);
CREATE INDEX blocks_parent_idx ON blocks (parent_id, idx);
CREATE INDEX blocks_type_idx   ON blocks (type);

-- ---------------------------------------------------------------------------
-- Materialised layer: collections
-- ---------------------------------------------------------------------------

CREATE TABLE collections (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  page_id        uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  title_field_id uuid NOT NULL,
  schema_version integer NOT NULL DEFAULT 1
);

ALTER TABLE pages
  ADD CONSTRAINT pages_collection_fk
  FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE;

CREATE TABLE collection_fields (
  id            uuid PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  field_type    text NOT NULL,
  -- Type-specific settings: select options, relation target, formula source.
  config        jsonb NOT NULL DEFAULT '{}',
  idx           text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1
);

CREATE INDEX collection_fields_collection_idx ON collection_fields (collection_id, idx);

CREATE TABLE collection_views (
  id             uuid PRIMARY KEY,
  collection_id  uuid NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  name           text NOT NULL,
  view_type      text NOT NULL,
  idx            text NOT NULL,
  -- Nested filter tree, sort rules, per-view field settings.
  definition     jsonb NOT NULL DEFAULT '{}',
  schema_version integer NOT NULL DEFAULT 1
);

CREATE INDEX collection_views_collection_idx ON collection_views (collection_id, idx);

-- Stored cell values only. Derived fields (formula, rollup, lookup, audit
-- fields) never appear here — they are computed at query time.
CREATE TABLE page_properties (
  page_id  uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES collection_fields (id) ON DELETE CASCADE,
  value    jsonb NOT NULL,
  -- Typed shadow columns. Filtering and sorting on jsonb is slow and its
  -- collation is wrong for dates and numbers; the materialiser fills
  -- whichever of these applies to the field type.
  text_value    text,
  number_value  double precision,
  date_start    timestamptz,
  date_end      timestamptz,
  bool_value    boolean,
  PRIMARY KEY (page_id, field_id)
);

CREATE INDEX page_properties_field_text_idx   ON page_properties (field_id, text_value);
CREATE INDEX page_properties_field_number_idx ON page_properties (field_id, number_value);
CREATE INDEX page_properties_field_date_idx   ON page_properties (field_id, date_start);
CREATE INDEX page_properties_field_bool_idx   ON page_properties (field_id, bool_value);

-- Relations are stored once, on the owning side. The inverse direction is a
-- query against this table, never a second stored list.
CREATE TABLE page_relations (
  from_page_id uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  field_id     uuid NOT NULL REFERENCES collection_fields (id) ON DELETE CASCADE,
  to_page_id   uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  idx          text NOT NULL,
  PRIMARY KEY (from_page_id, field_id, to_page_id)
);

CREATE INDEX page_relations_inverse_idx ON page_relations (to_page_id, field_id);

-- ---------------------------------------------------------------------------
-- Files
-- ---------------------------------------------------------------------------

CREATE TABLE files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- Files are authorised through the page they hang on.
  page_id      uuid REFERENCES pages (id) ON DELETE CASCADE,
  filename     text   NOT NULL,
  mime_type    text   NOT NULL,
  size_bytes   bigint NOT NULL,
  sha256       bytea  NOT NULL,
  -- 'local' or 's3'. Local filesystem is the default; S3 is opt-in.
  storage      text   NOT NULL DEFAULT 'local',
  storage_key  text   NOT NULL,
  uploaded_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX files_workspace_idx ON files (workspace_id);
CREATE INDEX files_sha_idx       ON files (workspace_id, sha256);

-- ---------------------------------------------------------------------------
-- Sharing
-- ---------------------------------------------------------------------------

CREATE TYPE share_role AS ENUM ('viewer', 'commenter', 'editor', 'admin');

CREATE TABLE share_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  scope_page_id  uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  -- Subtree scope is mandatory functionality, not a nicety: without it a
  -- shared link breaks as soon as somebody creates a subpage.
  include_subtree boolean    NOT NULL DEFAULT true,
  role           share_role  NOT NULL DEFAULT 'viewer',
  -- Only the hash is stored; the token itself is shown once on creation.
  token_hash     bytea       NOT NULL UNIQUE,
  password_hash  text,
  allow_anonymous boolean    NOT NULL DEFAULT true,
  expires_at     timestamptz,
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);

CREATE INDEX share_tokens_scope_idx ON share_tokens (scope_page_id)
  WHERE revoked_at IS NULL;

-- An anonymous visitor editing through a link. Not an account: a session with
-- claims and a display name, so presence and attribution work.
CREATE TABLE share_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_token_id uuid NOT NULL REFERENCES share_tokens (id) ON DELETE CASCADE,
  display_name   text NOT NULL,
  -- Truncated to /24 or /48 before storage; see docs/privacy.md.
  ip_prefix      inet,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);

CREATE INDEX share_sessions_token_idx ON share_sessions (share_token_id);

-- Explicit per-page grants for named users, independent of share links.
CREATE TABLE page_permissions (
  page_id         uuid NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role            share_role NOT NULL,
  include_subtree boolean NOT NULL DEFAULT true,
  granted_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, user_id)
);

CREATE INDEX page_permissions_user_idx ON page_permissions (user_id);

-- ---------------------------------------------------------------------------
-- Full-text search
-- ---------------------------------------------------------------------------

-- Postgres tsvector, not Elasticsearch. One fewer process to operate, and
-- adequate well past the scale a self-hosted instance will see.
CREATE TABLE page_search (
  page_id      uuid PRIMARY KEY REFERENCES pages (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- 'simple' avoids committing to one language per instance. Swap per
  -- workspace later via a config column if needed.
  tsv          tsvector NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX page_search_tsv_idx ON page_search USING gin (tsv);
CREATE INDEX page_search_ws_idx  ON page_search (workspace_id);

-- ---------------------------------------------------------------------------
-- Pub/sub between server instances
-- ---------------------------------------------------------------------------

-- LISTEN/NOTIFY instead of Redis. One process fewer than every comparable
-- project ships with (ADR-0005).
CREATE FUNCTION notify_doc_update() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'sone_doc_update',
    json_build_object('docId', NEW.doc_id, 'seq', NEW.seq)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER doc_updates_notify
  AFTER INSERT ON doc_updates
  FOR EACH ROW EXECUTE FUNCTION notify_doc_update();

-- ---------------------------------------------------------------------------
-- Schema bookkeeping
-- ---------------------------------------------------------------------------

CREATE TABLE schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('0001_init');

COMMIT;
