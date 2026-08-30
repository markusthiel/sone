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

// --- granting the right, and the way in -------------------------------------

const admin = codeOf(new URL('../src/components/Admin.tsx', import.meta.url));
const menu = codeOf(new URL('../src/components/WorkspaceMenu.tsx', import.meta.url));

test('the right is offered separately from being an administrator', () => {
  // Two checkboxes, because the point of the narrower one is that somebody can
  // hold it without the other (ADR-0027).
  assert.match(admin, /canManageWorkspaces: event\.target\.checked/);
  assert.match(admin, /Manages workspaces/);
});

test('it is shown as held, and locked, for an administrator', () => {
  // They have it anyway. A control that cannot change anything is one somebody
  // clicks and then wonders about — and the stored value is left alone, so a
  // later demotion gives back whatever was actually granted.
  assert.match(admin, /checked=\{user\.isInstanceAdmin \|\| user\.canManageWorkspaces\}/);
  assert.match(admin, /disabled=\{user\.isInstanceAdmin\}/);
});

test('the switcher offers the way in, and only to those who may', () => {
  // A shortcut into the one list, not a second place to do the same thing. And
  // absent rather than refusing: an entry that answers "not found" teaches
  // people to distrust the menu.
  assert.match(menu, /\{canManageWorkspaces && \(/);
  assert.match(menu, /paths\.settings\('workspaces'\)/);
});
