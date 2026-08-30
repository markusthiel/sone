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
  assert.match(list, /Last edited/);
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
const settings = codeOf(new URL('../src/components/Settings.tsx', import.meta.url));

test('the name opens the workspace rather than a separate control', () => {
  // A row that only reports numbers makes somebody wonder where the editing is,
  // and a "manage" column would be a second target for what the name already
  // identifies.
  assert.match(list, /onClick=\{\(\) => onOpen\(row\.id, row\.name\)\}/);
});

test('inviting uses the same panel a workspace owner uses', () => {
  // Given a different workspace, not reimplemented for administrators. Two
  // copies are two things to keep in step, and the one used less would rot.
  assert.match(detail, /<WorkspaceInvite workspaceId=\{workspaceId\} \/>/);
});

test('opening one is a step inside the section, not a place to link to', () => {
  assert.match(settings, /useState<\{ id: string; name: string \} \| null>/);
});

test('the list is read back rather than adjusted in place', () => {
  // The server refuses some of these — the last owner, somebody's own
  // workspace — and a list updated optimistically would show a change that did
  // not happen.
  assert.match(detail, /\.then\(load\)/);
  assert.doesNotMatch(detail, /setMembers\(members\.filter/);
});

test('a role is changed where it is shown', () => {
  // Not in a dialog: the list is where somebody is comparing people, and that
  // is where the comparison leads to a change.
  assert.match(detail, /api\.setMemberRole\(workspaceId, member\.userId, event\.target\.value\)/);
});
