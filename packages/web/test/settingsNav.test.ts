/**
 * The settings navigation (ADR-0032).
 *
 * Three areas, three lists, one frame. The tests worth having are about the
 * boundary between them — whose settings these are — and about the two things
 * that went wrong with one list of everything: two menu entries landing on the
 * same page, and two sections falling out of the list while the code below it
 * went on rendering them.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const shell = codeOf(new URL('../src/components/SettingsShell.tsx', import.meta.url));
const you = codeOf(new URL('../src/components/Settings.tsx', import.meta.url));
const workspace = codeOf(
  new URL('../src/components/WorkspaceSettingsScreen.tsx', import.meta.url),
);
const instance = codeOf(new URL('../src/components/AdminScreen.tsx', import.meta.url));

test('every settings column carries the same account menu', () => {
  // It was only in the sidebar, so from the administration area the way to your
  // own profile — or to the trash, or out — was back through the notes. The
  // switcher above only moves between areas.
  assert.match(shell, /<AccountMenu/);
  const account = codeOf(new URL('../src/components/AccountMenu.tsx', import.meta.url));
  assert.match(account, /className="sidebar-footer"/, 'the same footer, not a copy of it');
  // One component, used from both places rather than reimplemented in the shell.
  const sidebar = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
  assert.match(sidebar, /<AccountMenu/);
  assert.doesNotMatch(sidebar, /className="sidebar-account-menu"/);
});

test('the switcher at the top of the column is the same shape, holding areas', () => {
  // Where the workspace switcher sits in the application, so it is where
  // somebody has already learnt to look for "where am I, and what else is
  // there". The classes are the switcher's own — `switcher-*`, not
  // `workspace-*` — because the shape belongs to the position rather than to
  // either of the two things it holds.
  assert.match(shell, /className="switcher-button"/);
  assert.match(shell, /className="switcher-menu"/);
  assert.match(shell, /className="switcher-item"/);

  // The three areas, named for the subject as the areas themselves are.
  // By key, since the switcher's labels are translated (ADR-0041) — and the keys
  // name the same three subjects the record decided.
  for (const key of ['area.you', 'area.workspace', 'area.instance']) {
    assert.match(shell, new RegExp(`label: '${key}'`));
  }

  // Never in the workspace switcher's own menu: "which workspace" and "whose
  // settings" are different questions, and one menu holding both means two
  // things.
  const workspaceMenu = codeOf(
    new URL('../src/components/WorkspaceMenu.tsx', import.meta.url),
  );
  assert.doesNotMatch(workspaceMenu, /Your settings|Administration/);
});

test('the administration area is absent from the switcher without the right', () => {
  // Absent rather than present and refusing, as the entry into it is.
  assert.match(shell, /area\.id !== 'admin' \|\| canAdminister/);
  // And the right comes from the session, since the switcher only decides
  // whether to offer the entry — the area behind it asks the server.
  for (const [name, source] of [
    ['you', you],
    ['this workspace', workspace],
  ] as const) {
    assert.match(
      source,
      /session\.user\.isInstanceAdmin \|\| session\.user\.canManageWorkspaces/,
      name,
    );
  }
});

test('three areas, and each names whose settings it holds', () => {
  assert.match(you, /area="You"/);
  assert.match(workspace, /area="This workspace"/);
  assert.match(instance, /area=\{t\('area\.instance'\)\}/);
});

test('the workspace area says which workspace, under the area name', () => {
  // "This workspace" is true of five workspaces. Somebody with five needs to see
  // which one they are editing before they change its typography — and as a
  // quieter second line, because it is a fact rather than a choice.
  assert.match(workspace, /subtitle=\{workspace\?\.name \|\| 'Untitled'\}/);
  assert.match(shell, /className="switcher-sub"/);
  // And the heading that used to repeat the area name is gone, or the column says
  // the same thing twice in two lines.
  assert.doesNotMatch(shell, /className="sidebar-label">\{area\}/);
});

test('the profile and signing in are two sections', () => {
  // They were one, which is the last deviation ADR-0032 recorded. Different jobs
  // done at different times: a name is changed once, a password when something
  // has happened — and offering a current-password field to somebody editing
  // their display name reads as being asked to authenticate for no reason.
  assert.match(you, /id: 'profile', label: 'you\.profile'/);
  assert.match(you, /id: 'sign-in', label: 'you\.signIn'/);
  /*
   * The promise, not the exact expression.
   *
   * This pinned `current === 'sign-in' && <SignIn />` and failed when the
   * second factor joined that section (ADR-0063) — the second guard this week
   * to fail on an improvement because it asserted a shape rather than a
   * guarantee.
   */
  assert.match(you, /current === 'sign-in' &&/);
  assert.match(you, /<SignIn \/>/);

  // Two components, so neither carries the other's state. The password form
  // holding a display name in scope is how a rename ends up in a password
  // request.
  assert.match(you, /function Profile\(\{/);
  assert.match(you, /function SignIn\(\): ReactElement \{/);
  assert.doesNotMatch(you, /function Account\(\{/);
});

test('the boundary is whose it is, not who may change it', () => {
  // The two cases that look like exceptions. "Where you land" is about a
  // workspace and belongs to you, because two members have different answers.
  // Typography is about appearance and belongs to the workspace, because
  // everybody reading it sees it.
  assert.match(you, /id: 'landing'/);
  assert.doesNotMatch(workspace, /id: 'landing'/);
  assert.match(workspace, /id: 'typography'/);
  assert.doesNotMatch(you, /id: 'typography'/);
});

test('the two sections that had fallen out of the list are reachable', () => {
  // They were rendered by the old screen and removed from its list, so the
  // per-workspace typography and the groups could not be opened at all. This is
  // the test that would have caught it: a section that renders must be listed.
  for (const id of ['typography', 'groups']) {
    assert.match(workspace, new RegExp(`id: '${id}'`), `${id} is in the list`);
    assert.match(workspace, new RegExp(`current === '${id}'`), `${id} renders`);
  }
});

test('every section a screen renders is one the screen lists', () => {
  // Generalised from the failure above, for all three areas.
  for (const [name, source] of [
    ['you', you],
    ['this workspace', workspace],
    ['the instance', instance],
  ] as const) {
    const listed = new Set([...source.matchAll(/id: '([a-z-]+)'/g)].map((m) => m[1]));
    const rendered = [...source.matchAll(/current === '([a-z-]+)'/g)].map((m) => m[1]);
    for (const id of rendered) {
      assert.ok(listed.has(id), `${name}: '${id}' renders but is not listed`);
    }
  }
});

test('the administration area is filtered by two rights, not one', () => {
  // Somebody granted the right to administer workspaces is not an instance
  // administrator, and the point of the right is that they should not have to
  // be (ADR-0027).
  assert.match(instance, /if \(entry\.admin\) return isAdmin === true;/);
  assert.match(instance, /if \(entry\.manager\) return canManageWorkspaces;/);
  assert.match(instance, /session\.user\.canManageWorkspaces/);
});

test('an area with nothing in it renders nothing', () => {
  // Rather than a heading over an empty list, which is what filtering every
  // entry away would otherwise leave.
  assert.match(instance, /if \(available\.length === 0\) return null;/);
});

test('the frame is written once', () => {
  // Three areas must not mean three layouts: they drift, and the one used least
  // is the one that rots.
  for (const [name, source] of [
    ['you', you],
    ['this workspace', workspace],
    ['the instance', instance],
  ] as const) {
    assert.match(source, /<SettingsShell/, `${name} uses the shell`);
    assert.doesNotMatch(source, /settings-nav-item/, `${name} draws no navigation of its own`);
  }
  assert.match(shell, /className="settings-nav-item"/);
});

test('the navigation is names, not explanations', () => {
  // A line of explanation under each entry made every one three lines tall, and
  // a navigation that has to be read is a page about the navigation.
  assert.doesNotMatch(shell, /<span className="settings-nav-hint">/);
  assert.match(shell, /title=\{entry\.hint\}/);
});

test('each area is a screen of its own with a way out', () => {
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  for (const kind of ['settings', 'workspaceSettings', 'admin']) {
    assert.match(
      app,
      new RegExp(`if \\(route\\.kind === '${kind}'\\) \\{`),
      `${kind} returns early`,
    );
  }
  assert.match(shell, /t\('settings\.back'\)/);
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

test('the switcher offers this workspace to everyone and the list to those who may', () => {
  // Two different destinations, which is the point: one is the workspace you
  // are in, the other is every workspace here.
  assert.match(menu, /paths\.workspaceSettings\(\)/);
  assert.match(menu, /\{canManageWorkspaces && \(/);
  assert.match(menu, /paths\.admin\('workspaces'\)/);
});

test('a phone shows the list or the section, not both', () => {
  // Stacking them put every entry above the section, so the section scrolled in
  // whatever was left — a box a few lines tall.
  const css = stylesOf(new URL('../src/styles.css', import.meta.url));
  assert.match(css, /\.settings-screen\[data-showing='section'\] \.settings-nav \{ display: none/);
  assert.match(css, /\.settings-screen\[data-showing='list'\] \.settings-body \{ display: none/);
});

test('it starts on the section, not on the list', () => {
  // Arriving at a list of settings when you asked for one setting is a step
  // nobody wanted.
  assert.match(you, /useState\(false\);/);
  assert.match(shell, /data-showing=\{listOpen \? 'list' : 'section'\}/);
});

test('choosing an entry returns to the section', () => {
  // Otherwise the list stays over the thing it was asked to show.
  assert.match(shell, /onClick=\{\(\) => onListOpen\(false\)\}/);
});
