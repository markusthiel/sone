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

const detail = codeOf(new URL('../src/components/WorkspaceDetail.tsx', import.meta.url));
// The list lives in the administration area now: it is about every workspace
// here, including ones you are not in (ADR-0032).
const settings = codeOf(new URL('../src/components/AdminScreen.tsx', import.meta.url));

test('the name opens the workspace rather than a separate control', () => {
  // A row that only reports numbers makes somebody wonder where the editing is,
  // and a "manage" column would be a second target for what the name already
  // identifies.
  // Loosely: the callback gained the icon when workspaces got one, and a test
  // that names every argument fails on every argument added.
  assert.match(list, /onClick=\{\(\) => onOpen\(row\.id, row\.name/);
});

test('inviting uses the same panel a workspace owner uses', () => {
  // Given a different workspace, not reimplemented for administrators. Two
  // copies are two things to keep in step, and the one used less would rot.
  assert.match(detail, /<WorkspaceInvite workspaceId=\{workspaceId\} \/>/);
});

test('opening one is a step inside the section, not a place to link to', () => {
  assert.match(settings, /useState<\{\s*\n?\s*id: string;/);
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

test('the members table is one table, used from both places', () => {
  // It lived inside the administration screen, which is why administering
  // members required the instance-wide right in the interface while the server
  // had never asked for it (ADR-0032).
  const workspace = codeOf(
    new URL('../src/components/WorkspaceSettingsScreen.tsx', import.meta.url),
  );
  assert.match(detail, /<WorkspaceMembers workspaceId=\{workspaceId\} canAdminister \/>/);
  assert.match(workspace, /<WorkspaceMembers workspaceId=\{workspaceId\} canAdminister=\{canEdit\}/);
  // And no second copy of the table left behind in either.
  for (const source of [detail, workspace]) {
    assert.doesNotMatch(source, /Role for \$\{/);
  }
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
  assert.match(detail, /t\('workspaces\.confirmName'\)/);
  assert.match(detail, /disabled=\{confirmName\.trim\(\) !== name\}/);
});

test('the panel says nothing is removed yet', () => {
  // "Delete" that means "delete later" is worse than either if nobody says
  // which.
  assert.match(detail, /t\('workspaces\.delete\.note'\)/);
});

test('restoring is one click', () => {
  // Putting something back is not the action that needs slowing down.
  assert.match(list, /onRestore\(row\.id\)/);
  assert.match(settings, /restore: true/);
});
