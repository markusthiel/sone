/**
 * The shape every settings panel is being converted to.
 *
 * Two panels that group their controls differently are two panels somebody has
 * to learn separately, so this counts the conversion rather than describing one
 * panel: it is the list that says what is left.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const converted = [
  'Settings',
  'LandingSettings',
  'InvitePanel',
  'OidcPanel',
  'Admin',
  'GroupsPanel',
];

/**
 * Panels whose content is a table rather than a form.
 *
 * The row shape puts a label on one side and a control on the other, which is
 * right for a setting and wrong for a list of things being compared — six
 * workspaces are read down a column, not one row at a time. They take the
 * card's border and padding instead of its rows.
 */
const tabular = ['WorkspaceList'];

test('the converted panels group their controls into cards', () => {
  for (const name of converted) {
    const source = codeOf(new URL(`../src/components/${name}.tsx`, import.meta.url));
    assert.match(source, /className="settings-card"/, `${name} uses a card`);
    assert.match(source, /className="settings-row"/, `${name} uses rows`);
  }
});

test('a table gets the card frame rather than the card rows', () => {
  // Forcing a list of things being compared into label-and-control rows would
  // be applying the pattern rather than using it.
  const css = stylesOf(new URL('../src/styles.css', import.meta.url));
  assert.match(css, /\.workspace-table,\s*\n\.groups-table \{[^}]*border: 1px solid var\(--border-subtle\)/);
  for (const name of tabular) {
    const source = codeOf(new URL(`../src/components/${name}.tsx`, import.meta.url));
    assert.match(source, /<table/, `${name} is a table`);
  }
});

test('a converted row names the control it holds', () => {
  // The label moved out of a <label> and into the row, so the control needs to
  // say what it is on its own — otherwise the conversion quietly costs anybody
  // using a screen reader the field's name.
  for (const name of converted) {
    const source = codeOf(new URL(`../src/components/${name}.tsx`, import.meta.url));
    const rows = (source.match(/className="settings-row"/g) ?? []).length;
    const named = (source.match(/aria-label=/g) ?? []).length;
    assert.ok(named > 0 || rows === 0, `${name} names its controls`);
  }
});
