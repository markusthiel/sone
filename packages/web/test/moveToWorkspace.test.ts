/**
 * The dialog for moving an entry to another workspace (ADR-0038).
 *
 * The record's decision was to show what a move costs rather than refuse until
 * somebody has cleared it, so what these check is that the costs are counted
 * before anything happens and that the one that changes who can read something
 * is said first.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const dialog = codeOf(new URL('../src/components/MoveToWorkspaceDialog.tsx', import.meta.url));
const menu = codeOf(new URL('../src/components/EntryMenu.tsx', import.meta.url));
const app = codeOf(new URL('../src/App.tsx', import.meta.url));

test('it asks what the move costs before doing it', () => {
  // A dry run of the same code that performs the move, so the count is the
  // subtree's rather than an estimate.
  assert.match(dialog, /api\.moveToWorkspace\(entry\.id, workspaceId, true\)/);
  // And the real move is a second call, without the dry run.
  assert.match(dialog, /api\.moveToWorkspace\(entry\.id, target\)/);
  // The button cannot be pressed before the answer is in.
  assert.match(dialog, /disabled=\{busy \|\| cost === null\}/);
});

test('the restriction line comes first among the losses', () => {
  // It is the only consequence that changes who can read something.
  const order = dialog.slice(dialog.indexOf('function consequences'));
  assert.ok(
    order.indexOf('restriction they have now') < order.indexOf('share link'),
    'restrictions before share links',
  );
  assert.match(order, /everyone in the new workspace will be able to read them/);
});

test('only workspaces the person administers are offered', () => {
  // The same rule the route enforces. Filtering here too means the impossible
  // choice is never offered rather than offered and refused.
  assert.match(dialog, /workspace\.role === 'owner' \|\| workspace\.role === 'admin'/);
  assert.match(dialog, /workspace\.id !== currentWorkspaceId/);
  assert.match(dialog, /There is nowhere to move this/);
});

test('it is its own menu entry, not a destination in the ordinary move', () => {
  // A move within a workspace loses nothing; this one revokes share links and
  // drops restrictions. One list holding both would make them look alike.
  assert.match(menu, /Move to a workspace…/);
  assert.match(menu, /onStartMoveToWorkspace\(node\.id\)/);
});

test('after moving, the page being read is left', () => {
  // The entry is not in this workspace any more, so staying on it would show the
  // refusal we already have a bug report about.
  assert.match(app, /if \(pageId === movingToWorkspaceId\) navigate\(paths\.home\(\)\)/);
  assert.match(app, /void reloadPages\(\)/);
});
