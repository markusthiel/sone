/**
 * Where somebody lands in a workspace.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { en } from '../src/i18n/messages.en.ts';
import { codeOf } from './helpers/source.ts';

const app = codeOf(new URL('../src/App.tsx', import.meta.url));
const panel = codeOf(new URL('../src/components/LandingSettings.tsx', import.meta.url));

test('the landing page replaces "the first page in the tree"', () => {
  // Arbitrary: the first page is rarely the one anybody works in, and it moves
  // when somebody reorders the sidebar.
  assert.match(app, /api\s*\n?\s*\.landing\(workspaceId\)/);
  assert.match(app, /landing\.landOn \?\? first/);
});

test('arriving and pressing the mark are different questions', () => {
  /*
   * One setting answered both, and the difference only showed once the mark was
   * a button somebody presses on purpose (ADR-0072). Arriving means the setting
   * in full, "the page I was last on" included. Pressing the mark cannot mean
   * that — you are *on* that page — so it went nowhere, which read as broken.
   *
   * A later press goes to the top of the tree. A fixed landing page is honoured
   * either way: somebody who named a page meant that page.
   */
  assert.match(app, /const arrived = useRef<string \| null>\(null\);/);
  assert.match(app, /const again = arrived\.current === workspaceId;/);
  /*
   * Only `last` is skipped on a repeat arrival (ADR-0119). It used to read
   * "anything but fixed", which was the same rule while there were two modes —
   * `top` and `newest` are answers to "where does this workspace open", and
   * they mean it every time.
   */
  assert.match(app, /const mode = landing\.mode \?\? landing\.workspace\.mode;/);
  assert.match(app, /again && mode === 'last' \? first : \(landing\.landOn \?\? first\)/);
  // Per workspace, not per session: switching is an arrival in the new one, and
  // "the page I was last on" is the whole reason somebody switches back.
  assert.match(app, /arrived\.current = workspaceId;/);
});

test('a failed lookup still opens something', () => {
  // A preference that cannot be read should cost somebody a good guess, not a
  // blank screen.
  assert.match(app, /const first = pages\[0\];\s*\n\s*if \(first\) navigate/);
});

test('where somebody is is recorded on the page, not on leaving it', () => {
  // A tab closed without warning is the common way a session ends, and an
  // unload handler is the least reliable moment in a browser.
  assert.match(app, /setTimeout\(\(\) => \{[\s\S]{0,200}?setLanding\(workspaceId, \{ lastPageId/);
});

test('a chosen page that goes out of reach falls back rather than refusing', () => {
  // The one page somebody cannot avoid, so it must not be the one that fails.
  assert.match(panel, /t\('landing\.gone'\)/);
});

test('the setting is where the workspace is', () => {
  /*
   * A page in one workspace is no use in another — and the screen used to live
   * in the personal settings, which have exactly one workspace in scope,
   * whichever the person was standing in (ADR-0119). It edited that workspace's
   * row while looking like a preference about the person.
   */
  assert.match(panel, /workspaceId: string/);
  assert.match(panel, /\.setWorkspaceLanding\(workspaceId, next\)/, 'what the place says');
  assert.match(panel, /\.setLanding\(workspaceId, next\)/, 'and what one person says instead');

  const you = codeOf(new URL('../src/components/Settings.tsx', import.meta.url));
  assert.doesNotMatch(you, /LandingSettings/, 'and it is not in the personal settings');
  const workspace = codeOf(
    new URL('../src/components/WorkspaceSettingsScreen.tsx', import.meta.url),
  );
  assert.match(workspace, /<LandingSettings/);
});

test('somebody who may only read sees what the workspace does', () => {
  // The rights decide whether a control can be used, not whether it is there:
  // the workspace's answer is the thing a person's own setting departs from,
  // so hiding it would leave "for you" with nothing to be different from.
  assert.match(panel, /disabled=\{!canEdit\}/);
});

test('the choice is a card of rows, like the account page', () => {
  // The pattern is the point: two panels that group controls differently are
  // two panels somebody has to learn separately.
  assert.match(panel, /<div className="settings-card">/);
  assert.match(panel, /<label className="settings-row">/);
});

test('each choice says what it does, not just what it is called', () => {
  // "The page you were on last" and "A particular page" are distinguishable by
  // name only once you already know the difference.
  // The sentences live in the catalogue now (ADR-0041); what this test means is
  // that each choice has an explanation at all.
  assert.match(panel, /t\(one\.hint\)/, 'every mode carries one');
  for (const key of [
    'landing.lastPage.hint',
    'landing.top.hint',
    'landing.newest.hint',
    'landing.fixedPage.hint',
  ] as const) {
    assert.ok(en[key], `${key} exists`);
  }
  assert.match(en['landing.lastPage.hint'], /Follows you/);
  assert.match(en['landing.fixedPage.hint'], /whatever you were doing/);
  // And the one that needed saying: "neuste" is the page most recently
  // *edited*, not the one created last — an import would otherwise decide where
  // everybody lands.
  assert.match(en['landing.newest.hint'], /not the one created last/);
});
