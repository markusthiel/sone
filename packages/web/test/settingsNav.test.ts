/**
 * The settings navigation.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const settings = codeOf(new URL('../src/components/Settings.tsx', import.meta.url));

test('the groups are named for whose settings they are', () => {
  // "You" and "Administration" named who may change a thing rather than what
  // the thing belongs to, which is why two entries called "Invite people" gave
  // no clue which was which (ADR-0027).
  for (const group of ["group: 'You'", "group: 'Workspaces'", "group: 'Instance'"]) {
    assert.match(settings, new RegExp(group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(settings, /group: 'Administration'/);
});

test('the two invitations are told apart by name', () => {
  // Both were called "Invite people", in different groups, with nothing saying
  // which placed somebody in a team.
  assert.match(settings, /label: 'Invite to the instance'/);
  assert.doesNotMatch(settings, /label: 'Invite people'/);
});

test('every entry says in one line what is inside it', () => {
  // This area grows. A list of nouns makes somebody open three sections to find
  // one thing.
  const entries = settings.match(/\{ id: '[a-z-]+', label:/g) ?? [];
  const hints = settings.match(/hint: '/g) ?? [];
  assert.ok(hints.length >= entries.length, 'each entry has a hint');
});

test('the workspace section follows the right, not the admin flag', () => {
  // Somebody granted the right is not an instance administrator, and the point
  // of the right is that they should not have to be.
  assert.match(settings, /if \('manager' in entry\) return canManageWorkspaces;/);
  assert.match(settings, /session\.user\.canManageWorkspaces/);
});
