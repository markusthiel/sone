/**
 * Who may reach a page, in the sharing dialog.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const panel = codeOf(new URL('../src/components/PagePermissions.tsx', import.meta.url));
const dialog = codeOf(new URL('../src/components/ShareDialog.tsx', import.meta.url));

test('access for people inside sits with links for people outside', () => {
  // The same question asked twice — who gets to see this — and answering it in
  // two places is how somebody sets one and believes they have set the other.
  assert.match(dialog, /<PagePermissions pageId=\{pageId\}/);
});

test('an inherited grant is shown but not editable here', () => {
  // Editing it here would silently change access to everything else under the
  // ancestor it was set on.
  assert.match(panel, /grant\.inheritedFrom \?/);
  assert.match(panel, /from\{' '\}/);
});

test('somebody who may read but not manage gets no panel, not an error', () => {
  // They are not doing anything wrong by opening the dialog.
  assert.match(panel, /err\.code === 'forbidden' \|\| err\.code === 'not_found'/);
});

test('restricting explains that admins keep access', () => {
  // Otherwise it reads as a lock that locks everybody out, and somebody has to
  // be able to undo it.
  assert.match(panel, /Owners and admins still can/);
});

test('the panel says which direction a grant moves access', () => {
  // A grant on an unrestricted page widens and never narrows, which is not
  // obvious from a dropdown that lists "can view" under somebody who can
  // already edit.
  assert.match(panel, /never less/);
});
