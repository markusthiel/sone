-- SONE 0079 — Personal SOTE grants and workspace project mappings.
BEGIN;
CREATE TABLE sote_servers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), singleton boolean NOT NULL DEFAULT true UNIQUE CHECK(singleton),
 base_url text NOT NULL, client_id uuid NOT NULL, secret bytea NOT NULL
);
CREATE TABLE sote_accounts (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 server_id uuid NOT NULL REFERENCES sote_servers(id) ON DELETE CASCADE,
 token bytea NOT NULL, remote_user uuid NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,server_id)
);
CREATE TABLE sote_login_flows (
 state_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL, server_id uuid NOT NULL REFERENCES sote_servers(id) ON DELETE CASCADE,
 verifier bytea NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE sote_projects (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 server_id uuid NOT NULL REFERENCES sote_servers(id) ON DELETE CASCADE,
 project_id uuid NOT NULL, remote_workspace uuid NOT NULL,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 PRIMARY KEY(workspace_id,server_id,project_id)
);
INSERT INTO schema_migrations(version) VALUES ('0079_sote_integration');
COMMIT;

