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
const list = codeOf(new URL('../src/components/WorkspaceList.tsx', import.meta.url));
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

test('a switcher row is a row, in one rule', () => {
  // It was a column, which put the icon above the name and centred both — and
  // the later rule set `display: flex` without resetting the direction, so the
  // column survived. Third time this session that a half-overriding second rule
  // has done this.
  const rules = css.match(/\.workspace-item \{/g) ?? [];
  assert.equal(rules.length, 1, 'one rule lays it out');
  assert.match(css, /\.workspace-item \{[^}]*flex-direction: row/);
  assert.doesNotMatch(css, /\.workspace-item \{[^}]*flex-direction: column/);
});

test('a row is taller than its text, so it reads as a card', () => {
  assert.match(css, /min-block-size: calc\(var\(--sone-control-lg\) \* 1\.6\)/);
});

test('the switcher is inset like the search field below it', () => {
  // Two pixels of difference is invisible to measure and visible to look at:
  // the eye compares the two left edges, not the numbers.
  const button = /\.workspace-button \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const search = /\.sidebar-search \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const inset = (rule: string): string => /padding: ([^;]+);/.exec(rule)?.[1] ?? '';
  assert.equal(inset(button), inset(search));
});

test('choosing an icon does not reload the page', () => {
  // Reloading threw the panel away: the open workspace is state and not a
  // route, so the page came back at the list — which showed no marks, so the
  // change looked as if it had not been saved. It had.
  assert.doesNotMatch(detail, /onChanged=\{\(\) => window\.location\.reload\(\)\}/);
  assert.match(detail, /onChanged=\{setChosen\}/);
});

test('the chooser is given what it last saved', () => {
  // Otherwise choosing a colour after an icon sends a stale copy of the icon
  // and undoes it.
  assert.match(detail, /icon=\{chosen\}/);
  assert.match(chooser, /\.then\(\(saved\) => onChanged\(saved\.icon\)\)/);
});

test('the list shows the mark it let somebody choose', () => {
  // Not seeing it where workspaces are compared is why this looked unsaved.
  assert.match(list, /<WorkspaceMark name=\{row\.name\} icon=\{row\.icon \?\? null\} \/>/);
});
