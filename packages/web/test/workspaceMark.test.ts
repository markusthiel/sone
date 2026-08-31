/**
 * How a workspace is recognised in a list (ADR-0030).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const mark = codeOf(new URL('../src/components/WorkspaceMark.tsx', import.meta.url));
const menu = codeOf(new URL('../src/components/WorkspaceMenu.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('a workspace with no icon shows its initial, not nothing', () => {
  // The fallback is the point: one nobody has decorated should look deliberate
  // rather than unfinished, so the feature adds something instead of making
  // everything before it look incomplete.
  assert.match(mark, /name\.trim\(\)\.charAt\(0\)\.toUpperCase\(\) \|\| '\?'/);
});

test('the icon colour is separate from the text colour', () => {
  // The same split entries have, because somebody who has decorated a folder
  // already knows it.
  assert.match(mark, /icon\?\.iconColor \? \{ color: icon\.iconColor \}/);
});

test('the mark is the same size either way', () => {
  // So a list of workspaces is a column of marks rather than a ragged edge, and
  // decorating one does not move the others.
  assert.match(css, /\.workspace-mark \{[^}]*inline-size: 22px/);
});

test('the row is one line and the item count is gone', () => {
  // How many pages a workspace holds is not how anybody recognises it, and it
  // was the reason every row needed two lines.
  assert.doesNotMatch(menu, /workspace\.pageCount/);
  assert.match(css, /\.workspace-item \{[^}]*align-items: center/);
});

test('the icon reuses the entry renderer rather than a second one', () => {
  // Two similar systems are worse than one; the differences are what make them
  // worse.
  assert.match(mark, /<EntryIconView icon=\{chosen\} kind="folder" \/>/);
});

// --- choosing one -----------------------------------------------------------

const chooser = codeOf(new URL('../src/components/WorkspaceAppearance.tsx', import.meta.url));
const detail = codeOf(new URL('../src/components/WorkspaceDetail.tsx', import.meta.url));

test('the chooser reuses the entry controls rather than resembling them', () => {
  // Two similar pickers would differ in some small way, and the difference is
  // what makes them worse than one (ADR-0030).
  assert.match(chooser, /import \{ ColourRow \} from '\.\/EntryMenu\.tsx'/);
  assert.match(chooser, /ICON_NAMES/);
});

test('it sends the icon and never the name', () => {
  // A picker sending a name it never asked anybody about is how a rename
  // happens by accident.
  assert.match(chooser, /api\s*\n?\s*\.updateWorkspaceIcon\(workspaceId, next\)/);
});

test('colours survive a change of shape', () => {
  // Somebody who picked blue wants blue, not blue until they change their mind
  // about the icon.
  assert.match(chooser, /apply\(\{ \.\.\.icon, icon: name \}\)/);
});

test('"no colour" removes the property rather than setting undefined', () => {
  // This project treats an absent property and one set to undefined as
  // different things, and "no colour" means absent.
  assert.match(chooser, /delete next\.iconColor/);
  assert.match(chooser, /delete next\.titleColor/);
});

test('it is offered where a workspace is administered', () => {
  // Naming and decorating are the same act, so they belong in the same place.
  assert.match(detail, /<WorkspaceAppearance/);
});
