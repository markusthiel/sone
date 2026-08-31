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
  // Nothing in the creating half names one. The list beside it passes null,
  // which is how "the invitations that name no workspace" is asked for — so the
  // absence is asserted on the call rather than on the whole file.
  assert.doesNotMatch(panel, /inviteToInstance\([^)]*workspaceId/);
  assert.doesNotMatch(panel, /workspaceId=\{workspaceId\}/);
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

test('signing up through an invitation lands in the invited workspace', () => {
  // Everybody now has a workspace of their own, so without this somebody who
  // accepted an invitation arrives in their own empty one — a member of the
  // team they joined, looking at nothing to do with it.
  assert.match(app, /if \(workspaceId\) selectWorkspace\(workspaceId\)/);

  const auth = codeOf(new URL('../src/components/Auth.tsx', import.meta.url));
  assert.match(auth, /onDone\(created\.workspaceId\)/);
});

test('accepting with an account already lands there too', () => {
  // The other route to the same place, and it had the same fault: it navigated
  // home, which is now somebody's own workspace rather than the one they just
  // joined.
  assert.match(accept, /onJoined\(result\.workspaceId\)/);
  assert.match(app, /onJoined=\{\(workspaceId\) => \{/);
});

// --- inviting to a workspace ------------------------------------------------

const wsInvite = codeOf(new URL('../src/components/WorkspaceInvite.tsx', import.meta.url));

test('a workspace invitation names a role', () => {
  // Unlike an instance invitation, which places nobody: this one decides what
  // somebody can do the moment they arrive.
  assert.match(wsInvite, /inviteToWorkspace\(workspaceId, \{ email: email\.trim\(\) \|\| null, role \}\)/);
});

test('it says it works with or without an account', () => {
  // The question somebody actually has when they already invited a person to
  // the instance and now wants them in a team.
  assert.match(wsInvite, /whether or not they already have an account/);
});

test('an address-bound invitation says only that person can accept it', () => {
  // The server enforces it; saying so is what stops somebody forwarding the
  // link and wondering why it failed.
  assert.match(wsInvite, /only they can accept it/);
});

// --- seeing and withdrawing what was sent (ADR-0025) -------------------------

test('an invitation can be seen and withdrawn after it is created', () => {
  // Both forms produced a link and then forgot it, so one sent to the wrong
  // address stayed valid until it expired and nothing said it existed.
  const pending = codeOf(new URL('../src/components/PendingInvitations.tsx', import.meta.url));
  assert.match(pending, /\.revokeInvitation\(invitation\.id\)/);
  assert.match(pending, /\.then\(load\)/, 'read back rather than removed in place');

  // One component for both scopes: null asks for the invitations that name no
  // workspace.
  assert.match(pending, /workspaceId === null\s*\?\s*api\.instanceInvitations\(\)/);
  const workspace = codeOf(new URL('../src/components/WorkspaceInvite.tsx', import.meta.url));
  const instance = codeOf(new URL('../src/components/InvitePanel.tsx', import.meta.url));
  assert.match(workspace, /<PendingInvitations workspaceId=\{workspaceId\}/);
  assert.match(instance, /<PendingInvitations workspaceId=\{null\}/);
});

test('the list never reprints the link', () => {
  // A token is a credential. A list that shows every outstanding one turns "who
  // can see this screen" into "who can join".
  const pending = codeOf(new URL('../src/components/PendingInvitations.tsx', import.meta.url));
  assert.doesNotMatch(pending, /paths\.signup|invitation\.token/);
});

test('creating one refreshes the list beside the form', () => {
  // Otherwise the thing just created is the one thing missing from the list of
  // what is outstanding.
  for (const name of ['WorkspaceInvite', 'InvitePanel']) {
    const source = codeOf(new URL(`../src/components/${name}.tsx`, import.meta.url));
    assert.match(source, /setCreated\(\(previous\) => previous \+ 1\)/, name);
    assert.match(source, /reloadToken=\{created\}/, name);
  }
});
