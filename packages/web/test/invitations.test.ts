/**
 * Inviting somebody to the instance.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const panel = codeOf(new URL('../src/components/InvitePanel.tsx', import.meta.url));

test('an instance invitation names no workspace', () => {
  // The thing that could not be expressed before: an account here, without a
  // decision about which team somebody belongs to (ADR-0025).
  assert.match(panel, /inviteToInstance\(/);
  assert.doesNotMatch(panel, /workspaceId/);
});

test('the link uses the sign-up path that already exists', () => {
  // An invitation link has led there since invitations existed, and a second
  // route to the same place would be a second thing to keep working.
  assert.match(panel, /paths\.signup\(result\.token\)/);
});

test('the link is built from where the browser actually is', () => {
  // The server knows its configured public URL and not necessarily the one
  // somebody reached it by. Behind a proxy those differ, and a link nobody can
  // open is worse than no link.
  assert.match(panel, /window\.location\.origin/);
});

test('the token is shown once, and says so', () => {
  // The server stores a hash, so it cannot be recovered later — saying that
  // after somebody has closed the panel would be too late to be useful.
  assert.match(panel, /not stored anywhere it can be read again/);
});
