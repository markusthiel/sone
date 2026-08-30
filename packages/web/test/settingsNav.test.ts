/**
 * The settings navigation.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

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

test('the navigation is names, not explanations', () => {
  // A line of explanation under each entry made every one of them three lines
  // tall, and a navigation that has to be read is not a navigation — it is a
  // page about the navigation.
  assert.doesNotMatch(settings, /<span className="settings-nav-hint">/);
  // The explanation is still there, on the entry rather than beside it.
  assert.match(settings, /title=\{entry\.hint\}/);
});

test('settings is a screen of its own with a way out', () => {
  // It rendered in the content column, which put a sidebar of pages beside a
  // list of instance settings — two navigations for two unrelated things, and
  // neither the one somebody was using (ADR-0027).
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /if \(route\.kind === 'settings'\) \{[\s\S]{0,300}?return \(/);
  assert.match(settings, /Back to your notes/);
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

test('a phone shows the list or the section, not both', () => {
  // Stacking them put ten entries above the section, so the section scrolled in
  // whatever was left — a box a few lines tall.
  const css = stylesOf(new URL('../src/styles.css', import.meta.url));
  assert.match(css, /\.settings-screen\[data-showing='section'\] \.settings-nav \{ display: none/);
  assert.match(css, /\.settings-screen\[data-showing='list'\] \.settings-body \{ display: none/);
});

test('it starts on the section, not on the list', () => {
  // Arriving at a list of settings when you asked for one setting is a step
  // nobody wanted.
  assert.match(settings, /useState\(false\);/);
  assert.match(settings, /data-showing=\{listOpen \? 'list' : 'section'\}/);
});

test('choosing an entry returns to the section', () => {
  // Otherwise the list stays over the thing it was asked to show.
  assert.match(settings, /onClick=\{\(\) => setListOpen\(false\)\}/);
});
