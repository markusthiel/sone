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

// --- accepting with an account already --------------------------------------

const accept = codeOf(new URL('../src/components/AcceptInvitation.tsx', import.meta.url));
const app = codeOf(new URL('../src/App.tsx', import.meta.url));

test('a signed-in visitor following an invitation is not ignored', () => {
  // The sign-up route only renders for anonymous visitors, so this used to do
  // nothing visible: the person landed in their own workspace with no sign the
  // link had meant anything, and the invitation was not consumed.
  assert.match(app, /status === 'authenticated' && route\.kind === 'signup' && route\.invitationToken/);
});

test('joining says what it will and will not change', () => {
  // Somebody being invited to a team reasonably wonders whether their own
  // workspace is about to be replaced by it.
  assert.match(accept, /Your own workspace stays where it is/);
});

test('an instance invitation somebody already satisfied says so', () => {
  // Nothing is wrong — it simply happened already, and refusing would read as
  // a broken link.
  assert.match(accept, /instanceOnly &&/);
  assert.match(accept, /nothing to add/);
});

test('declining is navigating away, not a state', () => {
  // An invitation nobody accepts expires on its own. A "declined" state would
  // be a thing to store, to show, and to explain.
  assert.match(accept, /Not now/);
  assert.doesNotMatch(accept, /decline/i);
});

test('signing up leaves the invitation link behind', () => {
  // Registering uses the invitation, so leaving the token in the address bar
  // meant the accept screen rendered next, found the token spent, and said
  // something went wrong — after everything had gone right.
  assert.match(app, /navigate\(paths\.home\(\)\);\s*\n\s*void reload\(\);/);
});

test('a spent invitation says so rather than failing', () => {
  // Almost always one that has just been used, often by the person reading the
  // message. "Something went wrong" after everything went right is worse than
  // saying nothing at all.
  assert.match(accept, /setSpent\(true\)/);
  assert.match(accept, /already been used/);
});
