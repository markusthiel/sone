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
