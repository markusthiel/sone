/**
 * The sign-in page's provider button.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const auth = codeOf(new URL('../src/components/Auth.tsx', import.meta.url));

test('the provider button does not replace the password form', () => {
  // Both ways in stay available. An instance whose only door is somebody else's
  // service cannot be repaired when that service is unreachable (ADR-0024).
  assert.match(auth, /type="submit"/);
  assert.match(auth, /sso\.enabled &&/);
});

test('it is a link, not a button', () => {
  // It navigates to the provider, and the browser should treat it as a
  // navigation — a fetch would have to reimplement the redirect it triggers.
  assert.match(auth, /<a className="btn sso" href="\/api\/auth\/oidc\/start">/);
});

test('a failed lookup leaves no button rather than an error', () => {
  // Not having a provider and not being able to ask are the same thing from the
  // sign-in page: the password form is what matters here.
  assert.match(auth, /\.catch\(\(\) => \{/);
});

test('the page asks for the button, not for the configuration', () => {
  // The issuer and client id are no use to somebody who is not signed in, and
  // naming an internal identity server publicly is a small gift to whoever is
  // looking.
  assert.match(auth, /\.oidcConfig\(\)/);
  assert.doesNotMatch(auth, /issuer/);
});

// --- the administration form ------------------------------------------------

const panel = codeOf(new URL('../src/components/OidcPanel.tsx', import.meta.url));

test('the secret is never in the form, in either direction', () => {
  // It comes from the environment. A secret in a form is a secret on a screen,
  // and one in the database is a secret in every backup (ADR-0024).
  assert.doesNotMatch(panel, /clientSecret|client_secret/);
  assert.match(panel, /hasSecret/);
});

test('the missing secret is said first, not discovered later', () => {
  // Everything else can be filled in correctly and still not work without it,
  // and somebody who does not know that will conclude the form is broken.
  const warningAt = panel.indexOf('No client secret is set');
  const issuerAt = panel.indexOf('oidc-issuer');
  assert.ok(warningAt > 0 && warningAt < issuerAt, 'before the fields');
});

test('the switch cannot be turned on without a secret', () => {
  // A switch that turns on and does nothing is worse than one that explains
  // itself. The server refuses this too; the form does not offer it.
  assert.match(panel, /disabled=\{!hasSecret\}/);
});

test('the redirect URI is stated, since the provider needs it', () => {
  // The one piece of configuration that has to be entered somewhere else, and
  // the one nothing here can do for somebody.
  assert.match(panel, /\/api\/auth\/oidc\/callback/);
});
