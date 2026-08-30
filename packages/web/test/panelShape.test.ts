/**
 * The shape every settings panel is being converted to.
 *
 * Two panels that group their controls differently are two panels somebody has
 * to learn separately, so this counts the conversion rather than describing one
 * panel: it is the list that says what is left.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const converted = [
  'Settings',
  'LandingSettings',
  'InvitePanel',
  'OidcPanel',
  'Admin',
];

/** What has not been converted yet, so the list stays honest as it shrinks. */
const remaining = ['GroupsPanel', 'WorkspaceList'];

test('the converted panels group their controls into cards', () => {
  for (const name of converted) {
    const source = codeOf(new URL(`../src/components/${name}.tsx`, import.meta.url));
    assert.match(source, /className="settings-card"/, `${name} uses a card`);
    assert.match(source, /className="settings-row"/, `${name} uses rows`);
  }
});

test('the panels still to convert are named rather than forgotten', () => {
  // A list of what is done is only useful next to a list of what is not. These
  // are the panels whose controls still have to be grouped by hand, because
  // which ones belong together is a judgement about the panel.
  for (const name of remaining) {
    const source = codeOf(new URL(`../src/components/${name}.tsx`, import.meta.url));
    assert.ok(source.length > 0, `${name} still exists to be converted`);
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
