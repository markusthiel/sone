/**
 * The settings navigation (ADR-0032, and ADR-0069 for where it now lives).
 *
 * Three areas, three groups, one list in the panel. The tests worth having are about the
 * boundary between them — whose settings these are — and about the two things
 * that went wrong with one list of everything: two menu entries landing on the
 * same page, and two sections falling out of the list while the code below it
 * went on rendering them.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const nav = codeOf(new URL('../src/components/SectionNav.tsx', import.meta.url));
const you = codeOf(new URL('../src/components/Settings.tsx', import.meta.url));
const workspace = codeOf(
  new URL('../src/components/WorkspaceSettingsScreen.tsx', import.meta.url),
);
const instance = codeOf(new URL('../src/components/AdminScreen.tsx', import.meta.url));

test('every settings column carries the same account menu', () => {
  // It was only in the sidebar, so from the administration area the way to your
  // own profile — or to the trash, or out — was back through the notes.
  //
  // The column no longer carries its own: the rail does, and the rail is always
  // there (ADR-0069), which is the same promise kept with one copy instead of
  // two.
  const account = codeOf(new URL('../src/components/AccountMenu.tsx', import.meta.url));
  assert.match(account, /className="sidebar-footer"/, 'the same footer, not a copy of it');
  /*
   * One component, used from both places rather than reimplemented — and in
   * the shell it is built once by App and handed to whichever of the two can
   * draw it: the rail above 800px, the panel's foot below (ADR-0069). Two
   * mounted copies would be two requests for the same unread count and two
   * answers that can disagree for a moment.
   */
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /const accountMenu = \(\s*<AccountMenu/);
  assert.match(app, /account=\{isColumn \? accountMenu : null\}/, 'the rail, when there is one');
  assert.match(app, /account=\{isColumn \? null : accountMenu\}/, 'the panel otherwise');
  const sidebar = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
  assert.doesNotMatch(sidebar, /<AccountMenu/, 'given to the panel, not built by it');
  assert.doesNotMatch(sidebar, /className="sidebar-account-menu"/);
});

test('the three areas are three groups in one list', () => {
  /*
   * The switcher is gone (ADR-0069).
   *
   * It existed because the settings covered the application: a screen with no
   * rail beside it needs its own way of saying "here are the other two areas".
   * With the rail always there, the three are three groups in one list, which
   * is the same information without a menu you have to open to find out that
   * the other two exist.
   */
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /title: t\('area\.you'\)/);
  assert.match(app, /title: t\('area\.instance'\)/);
  assert.doesNotMatch(nav, /switcher-button/, 'no switcher, and none reimplemented');

  // Never in the workspace switcher's own menu: "which workspace" and "whose
  // settings" are different questions, and one menu holding both means two
  // things.
  const workspaceMenu = codeOf(
    new URL('../src/components/WorkspaceMenu.tsx', import.meta.url),
  );
  assert.doesNotMatch(workspaceMenu, /Your settings|Administration/);
});

test('the administration group is absent without the right', () => {
  // Absent rather than present and refusing, as the entry into it is.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /if \(session\.user\.isInstanceAdmin\) \{\s*\n\s*settingsGroups\.push/);
  // And the right comes from the session, since the list only decides whether
  // to offer the entry — the area behind it asks the server.
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

test('the workspace group is named after the workspace', () => {
  /*
   * "This workspace" is true of five workspaces, and an administrator opening
   * somebody else's has to see which one before changing its typography. The
   * group's title is the name itself now rather than an area name with the
   * workspace as a second line under it — one line, and it says the thing.
   */
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /title: settingsWorkspaceName \|\| t\('workspace\.untitled'\)/);
  // And it is the workspace in the address when there is one, not the one being
  // looked at — otherwise opening somebody else's names yours.
  assert.match(app, /route\.workspaceId \?\? workspaceId/);
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
  /*
   * One right, because the administration is the instance now (ADR-0067
   * amendment).
   *
   * The workspaces section was the only one that answered to the
   * workspace-management right, and it has moved to its own area which
   * everybody reaches. What is left here — accounts, single sign-on, mail,
   * maintenance — is the server, and being an instance administrator is the
   * question for all of it.
   */
  assert.match(instance, /if \(entry\.admin\) return isAdmin === true;/);
  assert.doesNotMatch(instance, /entry\.manager/);
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
    assert.match(source, /className="settings-body"/, `${name} is a body, not a screen`);
    assert.doesNotMatch(source, /settings-nav-item/, `${name} draws no navigation of its own`);
  }
  assert.match(nav, /className="settings-nav-item"/);
});

test('the navigation is names, not explanations', () => {
  // A line of explanation under each entry made every one three lines tall, and
  // a navigation that has to be read is a page about the navigation.
  assert.doesNotMatch(nav, /<span className="settings-nav-hint">/);
  assert.match(nav, /title=\{entry\.hint\}/);
});

test('no area is a screen of its own any more', () => {
  /*
   * They were: four routes returned before the shell rendered, so opening any
   * of them took the whole frame away and brought a different one back — and
   * each therefore needed its own door out.
   *
   * They are content in the shell now (ADR-0069). The way back is the mark,
   * which is on screen the whole time, so the door and the early return went
   * together.
   */
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  for (const kind of ['settings', 'workspaceSettings', 'admin', 'workspaceList']) {
    assert.doesNotMatch(
      app,
      new RegExp(`if \\(route\\.kind === '${kind}'\\) \\{`),
      `${kind} does not return early`,
    );
    assert.match(app, new RegExp(`route\\.kind === '${kind}' && \\(`), `${kind} is content`);
  }
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

test('the phone has one mechanism for this, not a second one', () => {
  /*
   * The settings screen had its own: a `data-showing` attribute flipping
   * between "the list" and "the section", plus the state and the two handlers
   * that drove it.
   *
   * The list is the panel now, and on a phone the panel is already the drawer —
   * it slides, it has a scrim, it closes on navigation. One mechanism doing the
   * job of two, and the one that is left is the one the rest of the interface
   * already uses (ADR-0069).
   */
  const css = stylesOf(new URL('../src/styles.css', import.meta.url));
  assert.doesNotMatch(css, /data-showing/);
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.doesNotMatch(app, /listOpen/);
  for (const source of [you, workspace, instance]) {
    assert.doesNotMatch(source, /listOpen/);
  }
});
