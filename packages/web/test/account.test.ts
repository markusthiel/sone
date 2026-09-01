/**
 * The account panel.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const settings = codeOf(new URL('../src/components/Settings.tsx', import.meta.url));

test('the name can be changed, and the page is reloaded after', () => {
  // It appears in the sidebar, in presence, and beside every block somebody
  // wrote. A copy updated here would leave the others saying the old one.
  assert.match(settings, /updateProfile\(\{ displayName: name\.trim\(\) \}\)/);
  assert.match(settings, /window\.location\.reload\(\)/);
});

test('changing a password asks for the current one', () => {
  // Not a formality: a session left open on a shared machine is the ordinary
  // way an account is taken, and without this whoever finds it can lock its
  // owner out in two fields.
  assert.match(settings, /autoComplete="current-password"/);
  assert.match(settings, /current === '' \|\| next\.length < 12/);
});

test('the minimum matches the one the server enforces', () => {
  // A form that accepts eleven characters and a server that refuses them is a
  // form that lies about what it will do.
  assert.match(settings, /At least twelve characters/);
});

test('what cannot be changed says why', () => {
  // An address that is simply displayed reads as an oversight; one that
  // explains itself reads as a decision.
  assert.match(settings, /t\('you\.email\.hint'\)/);
});

// --- structure --------------------------------------------------------------

import { stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('a settings page has three structural devices and no more', () => {
  // A heading opens a topic, a card groups the controls of one, space between
  // cards separates topics. Everything used to run together at one distance,
  // so nothing said where one thing ended and the next began.
  assert.match(css, /\.settings-card \{/);
  assert.match(css, /\.settings-row \{/);
  assert.match(css, /\.settings-section h2 \{/);
});

test('a card is bordered rather than filled', () => {
  // A filled panel on a page of filled panels is a page of grey rectangles.
  assert.match(css, /\.settings-card \{[^}]*border: 1px solid var\(--border-subtle\)/);
});

test('the last row of a card carries no rule', () => {
  // A divider under the final row divides it from nothing.
  assert.match(css, /\.settings-row:last-child \{[^}]*border-block-end: 0/);
});

test('the explanation sits under the name, not beside the control', () => {
  // A sentence next to a switch is a sentence people read as part of the
  // switch.
  // The name is a key now (ADR-0041); the shape being asserted is unchanged.
  assert.match(
    settings,
    /<span className="settings-row-label">\s*\n\s*<b>\{t\('you\.name'\)\}<\/b>/,
  );
});

test('there is one rule for the actions row', () => {
  // There were briefly two, which is how the sidebar footer stacked: a second
  // rule setting some of the same properties leaves the rest of the first
  // standing.
  const rules = css.match(/\.settings-actions \{/g) ?? [];
  assert.equal(rules.length, 1);
});

test('a label cannot be squeezed below a readable width', () => {
  // It collapsed to one word per line: the control beside it is an input, which
  // carries width: 100% from the base rule, so as a flex item its natural size
  // was the whole row and nothing was left. That narrow does not read as
  // narrow — it reads as broken.
  assert.match(css, /\.settings-row \.settings-row-label \{[^}]*min-inline-size: 14rem/);
  assert.match(css, /\.settings-row input,\s*\n\.settings-row select \{[^}]*inline-size: 18rem/);
});

test('the page is wider than a column of prose', () => {
  // 42rem is right for sentences and wrong for a row with a label on one side
  // and a control on the other: it cropped the page to a strip, which reads as
  // something failing to load rather than as a measure.
  assert.match(css, /\.settings-body > \* \{[^}]*max-inline-size: 60rem/);
});

test('a narrow screen stacks the row instead of squeezing it', () => {
  // Side by side stops working below a point, and below it the label wraps to
  // two lines while the field has nowhere to go.
  assert.match(css, /@media \(max-width: 620px\) \{\s*\n\s*\.settings-row \{[^}]*flex-direction: column/);
});

test('the older panels share the same rhythm', () => {
  // Most panels still use `.field` rather than cards. Lifting that shape
  // reaches all of them at once; converting each is better and slower, and this
  // is what the pages look like until it is done.
  assert.match(css, /\.field \+ \.field \{ margin-block-start: var\(--sone-space-6\)/);
  assert.match(css, /\.field label \{[^}]*font-weight: 550/);
});

test('a field does not run the width of the page', () => {
  // A text input 60rem wide invites an answer nobody wants to type and is
  // harder to read back than one of a sane measure.
  assert.match(css, /\.field \{[^}]*max-inline-size: 32rem/);
});
