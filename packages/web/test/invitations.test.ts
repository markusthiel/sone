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
  /*
   * The server stores a hash, so it cannot be recovered later — saying that
   * after somebody has closed the panel would be too late to be useful.
   *
   * The sentence itself moved into the catalogue with ADR-0147, and with it the
   * claim it used to carry: *„this instance does not send mail"*, printed
   * unconditionally on a route that has been sending the invitation since
   * ADR-0121. Which of the two sentences is shown is asserted on the mounted
   * panel in `invitationRow.test.tsx`; what is asserted here is that neither is
   * written into the markup again.
   */
  assert.match(panel, /t\('invite\.link\.note'\)/);
  assert.doesNotMatch(panel, /does not send mail/);
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
  assert.match(accept, /t\('invitation\.keepsYours'\)/);
});

test('an instance invitation somebody already satisfied says so', () => {
  // Nothing is wrong — it simply happened already, and refusing would read as
  // a broken link.
  assert.match(accept, /instanceOnly &&/);
  assert.match(accept, /t\('invitation\.alreadyMember'\)/);
});

test('declining is navigating away, not a state', () => {
  // An invitation nobody accepts expires on its own. A "declined" state would
  // be a thing to store, to show, and to explain.
  assert.match(accept, /t\('action\.notNow'\)/);
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
  assert.match(accept, /t\('invitation\.used'\)/);
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

// --- access to a workspace, which is not an invitation (ADR-0073) -----------

const members = codeOf(new URL('../src/components/WorkspaceMembers.tsx', import.meta.url));

test('a workspace gives access to accounts that exist, and invites nobody', () => {
  /*
   * One form was doing two jobs. An invitation makes an *account* for somebody
   * who is not on this server, which is whoever runs the server's business.
   * Access says which of the people already here may work in this workspace,
   * which is the owner's. Conflating them meant a workspace owner could quietly
   * create people on the instance.
   */
  /*
   * **The `addMember` half of this has moved** to `giveAccess.test.tsx`
   * (ADR-0103). It asserted the source read
   * `api.addMember(workspaceId, { email: address, role })`, and the call now
   * sends a role id — so the assertion broke on a change that made the form do
   * more of what this test is about, while the two assertions below, which are
   * about things being *absent*, still say exactly what they meant.
   *
   * Fourth source-text assertion in this repository to break that way
   * (ADR-0095 moved two, ADR-0102 one). A source test checks where a call is
   * written; nobody cares where.
   */
  const client = codeOf(new URL('../src/api/client.ts', import.meta.url));
  assert.doesNotMatch(client, /inviteToWorkspace/, 'and the way to do it is gone');
  const screen = codeOf(
    new URL('../src/components/WorkspaceSettingsScreen.tsx', import.meta.url),
  );
  assert.doesNotMatch(screen, /id: 'invitations'/, 'and so is the section');
});

test('access is given to somebody found, never chosen from a list of everybody', () => {
  /*
   * ADR-0073 answered this with an address field: "a picker of every account on
   * the server would turn every workspace owner into a reader of the instance's
   * directory, which is a right the administration keeps on purpose"
   * (ADR-0032).
   *
   * The concern stands and the address field was too strong an answer
   * (ADR-0119): the adding route already tells this same caller whether any
   * given address has an account, plainly and by design, so address → account
   * was never protected from them. What the form does now is find a person by
   * name or address — and what makes that a confirmation rather than a listing
   * is that **there are no results without two characters**.
   *
   * That rule lives on the route, which is where it can be enforced, and it is
   * proven there: `accessWithARole.db.test.ts` asserts that "", " " and "a"
   * return nobody with two accounts present. What is asserted here is only that
   * the screen has not grown a second way in — the administration's own listing
   * of every account stays where it is.
   */
  assert.match(members, /t\('access\.person'\)/);
  assert.doesNotMatch(members, /adminUsers/);

  const route = codeOf(new URL('../../server/src/auth/invitationRoutes.ts', import.meta.url));
  assert.match(route, /query\.length < 2/, 'nothing without two characters');
  assert.match(route, /LIMIT 8/, 'and never more than a handful');
});

/*
 * **"Not as an owner in one step" has moved** to `giveAccess.test.tsx`
 * (ADR-0103).
 *
 * It read the hardcoded `ADDABLE` list and asserted `'owner'` was not in it.
 * The offer now comes from the server and *does* contain owner, so the absence
 * became something this screen decides rather than something it inherits from a
 * short list — which is precisely when it stops being provable from the source
 * and starts needing a rendered picker to look at.
 *
 * The server refuses it too, by word and by id, in `accessWithARole.db.test.ts`.
 */

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
  // Both scopes still list what is outstanding. A workspace makes no new ones
  // (ADR-0073), but one sent last week is still a way in, and something that
  // cannot be seen cannot be withdrawn.
  const instance = codeOf(new URL('../src/components/InvitePanel.tsx', import.meta.url));
  assert.match(members, /<PendingInvitations workspaceId=\{workspaceId\}/);
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
  // The instance's form, which is the only one that creates invitations now.
  const source = codeOf(new URL('../src/components/InvitePanel.tsx', import.meta.url));
  assert.match(source, /setCreated\(\(previous\) => previous \+ 1\)/);
  assert.match(source, /reloadToken=\{created\}/);
});
