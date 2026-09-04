/**
 * Every workspace on the instance.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const list = codeOf(new URL('../src/components/WorkspaceList.tsx', import.meta.url));

test('personal workspaces are separated from shared ones', () => {
  // Everybody has one, so on an instance of forty people there are forty — and
  // listed together with the teams they would drown them (ADR-0027).
  assert.match(list, /rows\.filter\(\(row\) => !row\.personal\)/);
  assert.match(list, /rows\.filter\(\(row\) => row\.personal\)/);
});

test('personal ones are folded away but still reachable', () => {
  // "Who has an account and what is in it" is a question this list should be
  // able to answer.
  assert.match(list, /showPersonal/);
  assert.match(list, /One for each account/);
});

test('the list says which workspaces are alive', () => {
  // Without a date, deciding anything means opening every one of them.
  assert.match(list, /t\('workspaces\.lastEdited'\)/);
  assert.match(list, /const when = /);
});

test('the workspace you are in is one row, marked', () => {
  // Not a separate screen: two interfaces for one job, and the one nobody uses
  // is the one that drifts.
  assert.match(list, /row\.id === currentWorkspaceId/);
  assert.match(list, /you are here/);
});

// --- administering one of them ----------------------------------------------

// One screen now, reached from the list and from the account menu alike
// (ADR-0067). `WorkspaceDetail` is gone: it was the second interface ADR-0027
// had rejected in the first place.
const deletion = codeOf(
  new URL('../src/components/WorkspaceDeletion.tsx', import.meta.url),
);
const workspaceScreen = codeOf(
  new URL('../src/components/WorkspaceSettingsScreen.tsx', import.meta.url),
);
// The list lives in the administration area now: it is about every workspace
// here, including ones you are not in (ADR-0032).
const admin = codeOf(new URL('../src/components/AdminScreen.tsx', import.meta.url));

test('the name opens the workspace rather than a separate control', () => {
  // A row that only reports numbers makes somebody wonder where the editing is,
  // and a "manage" column would be a second target for what the name already
  // identifies.
  // Loosely: the callback gained the icon when workspaces got one, and a test
  // that names every argument fails on every argument added.
  assert.match(list, /onClick=\{\(\) => onOpen\(row\.id, row\.name/);
});

test('inviting uses the same panel a workspace owner uses', () => {
  /*
   * Still the point, now stronger: there is one screen rather than two sharing
   * a panel (ADR-0067).
   *
   * This read `WorkspaceDetail`, which no longer exists — it had drifted from
   * the screen at `/workspace/…` until neither could do the whole job, which is
   * exactly what ADR-0027 predicted would happen to whichever of the two got
   * used less.
   */
  // Access rather than an invitation (ADR-0073), and inside the table of who is
  // here rather than beside it.
  assert.match(workspaceScreen, /<WorkspaceMembers workspaceId=\{workspaceId\} canAdminister=\{canEdit\} \/>/);
});

test('opening one is a place to link to', () => {
  /*
   * The reverse of what this asserted, deliberately.
   *
   * It required the administration to hold the opened workspace in local state
   * — "a step inside the section, not a place to link to". ADR-0067 undoes that
   * decision: the id is in the address, so there is one URL for a workspace's
   * settings whichever direction it is reached from, and nothing left to drift.
   */
  // In the list's own screen now: the administration has given workspaces up
  // entirely, because they are not instance settings (ADR-0067 amendment).
  const listScreen = codeOf(
    new URL('../src/components/WorkspaceListScreen.tsx', import.meta.url),
  );
  assert.match(listScreen, /paths\.workspaceSettings\('general', id\)/);
  assert.doesNotMatch(admin, /useState<\{\s*\n?\s*id: string;/);
});

const members = codeOf(new URL('../src/components/WorkspaceMembers.tsx', import.meta.url));

test('the list is read back rather than adjusted in place', () => {
  // The server refuses some of these — the last owner, somebody's own
  // workspace — and a list updated optimistically would show a change that did
  // not happen.
  assert.match(members, /\.then\(load\)/);
  assert.doesNotMatch(members, /setMembers\(members\.filter/);
});

test('a role is changed where it is shown', () => {
  // Not in a dialog: the list is where somebody is comparing people, and that
  // is where the comparison leads to a change.
  assert.match(
    members,
    /api\.setMemberRole\(workspaceId, member\.userId, event\.target\.value\)/,
  );
});

test('the members table is one table, with one caller', () => {
  // It lived inside the administration screen, which is why administering
  // members required the instance-wide right in the interface while the server
  // had never asked for it (ADR-0032).
  const workspace = codeOf(
    new URL('../src/components/WorkspaceSettingsScreen.tsx', import.meta.url),
  );
  /*
   * One table, and now one caller (ADR-0067).
   *
   * This asserted the same component in two screens, which was the best that
   * could be said while there were two. There is one, and it passes the right
   * rather than a hardcoded `canAdminister` — the administration's copy had it
   * unconditionally true, which was correct there and is what made merging them
   * a rights question rather than a layout one.
   */
  assert.match(workspace, /<WorkspaceMembers workspaceId=\{workspaceId\} canAdminister=\{canEdit\}/);
  // And no second copy of the table left behind in either.
  // One source to check, since there is one screen. The loop existed because
  // there were two, which is the thing ADR-0067 removed.
  assert.doesNotMatch(workspace, /Role for \$\{/);
});

test('a member who may not administer reads the list rather than losing it', () => {
  // Knowing who else is in a workspace is not administration, and a section
  // that disappears makes people ask whether they are in the right place.
  assert.match(members, /canAdminister \? \(/);
  assert.match(members, /\{canAdminister && \(/);
});

// --- deleting one -----------------------------------------------------------

test('deleting asks for the name rather than a confirmation', () => {
  // A dialog is dismissed by the same reflex that opened it, and this takes
  // everybody's pages with it. Typing the name is a moment of reading what you
  // are about to do (ADR-0027).
  // In its own component now, so the one workspace screen can hold it — an
  // owner could not delete their own workspace before (ADR-0067).
  assert.match(deletion, /t\('workspaces\.confirmName'\)/);
  // The name still has to match, whatever the rights say: a button enabled by a
  // right alone would be one click from gone.
  assert.match(deletion, /disabled=\{!canDelete \|\| confirmName\.trim\(\) !== name\}/);
  // Present and disabled rather than absent, which is ADR-0067's rule and this
  // is its one exception in the other direction.
  assert.match(deletion, /t\('workspace\.delete\.notYours'\)/);
});

test('the panel says nothing is removed yet', () => {
  // "Delete" that means "delete later" is worse than either if nobody says
  // which.
  assert.match(deletion, /t\('workspaces\.delete\.note'\)/);
});

test('restoring is one click', () => {
  // Putting something back is not the action that needs slowing down.
  assert.match(list, /onRestore\(row\.id\)/);
  // In the list's screen: the administration no longer holds the list at all.
  assert.match(
    codeOf(new URL('../src/components/WorkspaceListScreen.tsx', import.meta.url)),
    /restore: true/,
  );
});
