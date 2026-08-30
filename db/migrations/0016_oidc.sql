-- SONE 0016 — signing in through an identity provider (ADR-0024).
--
-- Two things: which provider this instance uses, and which account belongs to
-- which person at that provider.
--
-- The client secret is deliberately absent. It lives in the environment
-- (SONE_OIDC_CLIENT_SECRET), because a secret in a table is a secret in every
-- backup and a secret in a form is one on a screen.

BEGIN;

-- One row, or none. A settings table rather than columns on instance_meta
-- because this grows, and every addition to a wide settings row is a migration
-- that rewrites it.
CREATE TABLE IF NOT EXISTS oidc_settings (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- The provider's base URL. Everything else is read from its discovery
  -- document, so nothing here encodes what any particular provider does.
  issuer        text NOT NULL,
  client_id     text NOT NULL,
  -- What the button says. Somebody signing in recognises "Continue with
  -- Company Login" and not "Continue with OIDC".
  button_label  text NOT NULL DEFAULT 'Single sign-on',
  -- Whether a person unknown to this instance may create an account by signing
  -- in. Off by default: an instance that trusts a provider to *authenticate* is
  -- not necessarily one that lets everybody at that provider in.
  allow_signup  boolean NOT NULL DEFAULT false,
  enabled       boolean NOT NULL DEFAULT false,
  updated_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE oidc_settings IS
  'How this instance talks to its identity provider. At most one row. The '
  'client secret is not here — it comes from the environment (ADR-0024).';

-- Which person at the provider is which account here.
--
-- Keyed by (issuer, subject) and not by email. An email is a label: changeable,
-- reassignable, and at some providers claimable without proof, so matching on
-- it would hand account takeover to whoever can edit an address elsewhere.
CREATE TABLE IF NOT EXISTS oidc_identities (
  issuer     text NOT NULL,
  subject    text NOT NULL,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz,
  PRIMARY KEY (issuer, subject)
);

-- One account cannot be reached from two identities at the same provider.
-- Without this, a second sign-in that created a fresh subject would silently
-- give somebody a second door into one account and no way to see it.
CREATE UNIQUE INDEX IF NOT EXISTS oidc_identities_one_per_user
  ON oidc_identities (issuer, user_id);

INSERT INTO schema_migrations (version) VALUES ('0016_oidc')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
