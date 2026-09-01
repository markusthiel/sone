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
  assert.match(app, /landing\.landOn \?\? pages\[0\]\?\.id/);
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

test('the fixed page is chosen per workspace', () => {
  // A page in one workspace is no use in another.
  assert.match(panel, /workspaceId: string/);
  assert.match(panel, /\.setLanding\(workspaceId, next\)/);
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
  assert.match(panel, /t\('landing\.lastPage\.hint'\)/);
  assert.match(panel, /t\('landing\.fixedPage\.hint'\)/);
  assert.match(en['landing.lastPage.hint'], /Follows you/);
  assert.match(en['landing.fixedPage.hint'], /whatever you were doing/);
});
