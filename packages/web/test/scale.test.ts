/**
 * The size scale.
 *
 * A checkbox rendered 44px tall because a global button minimum applied to it.
 * That is what this scale exists to prevent: a size chosen once, in the wrong
 * place, applying everywhere.
 *
 * These tests read the stylesheet as text. That is unusual and deliberate —
 * jsdom does not compute layout, so the only thing testable is whether the
 * rules say what they should. It catches the two mistakes that actually
 * happened: an element-wide rule that should be a class, and a control with a
 * hand-picked size instead of a scale value.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const raw = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/styles.css'),
  'utf8',
);

/**
 * The stylesheet without comments.
 *
 * A first version of the size check scanned the raw file and flagged a
 * `min-height: 44px` written inside a comment explaining why that value is
 * wrong. A check with false positives is worse than no check: it teaches people
 * to ignore the output. The same mistake was made once before, in the migration
 * checker, on apostrophes.
 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

test('comments are excluded from the scan', () => {
  // The check below would otherwise flag the comment that explains why a
  // hand-written 44px is wrong.
  assert.ok(raw.includes('min-height: 44px'), 'the explaining comment is still there');
  assert.ok(!css.includes('min-height: 44px'), 'and it is not scanned as a rule');
});

test('the scale is defined', () => {
  for (const name of [
    '--sone-marker',
    '--sone-control',
    '--sone-control-lg',
    '--sone-tap',
    '--sone-space-4',
    '--sone-radius',
  ]) {
    assert.ok(css.includes(`${name}:`), `${name} is not defined`);
  }
});

test('the bare button selector styles nothing but inheritance', () => {
  // `button { min-height: 44px }` is what stretched a 15px checkbox into a
  // rounded rectangle overlapping its own label. A button is used for form
  // submits, icon buttons, menu items, checkboxes and disclosure triangles;
  // sizing all of those together cannot be right.
  const match = /\nbutton \{([^}]*)\}/.exec(css);
  assert.ok(match, 'a bare button rule should still exist for font and cursor');
  const body = match[1]!;
  for (const forbidden of ['min-height', 'min-block-size', 'padding', 'border:']) {
    assert.ok(
      !body.includes(forbidden),
      `the bare button rule sets ${forbidden}, which then applies to every control`,
    );
  }
});

test('the framed button style is opt-in', () => {
  assert.ok(css.includes('button.btn'), 'a .btn class should carry the framed style');
});

test('markers are sized in both directions and opt out of any minimum', () => {
  // min-height beats height. A marker that sets only `block-size` is one global
  // rule away from being stretched again.
  const marker = /\.ProseMirror \.sone-todo-marker \{([^}]*)\}/.exec(css);
  assert.ok(marker, 'the checkbox rule should exist');
  assert.match(marker[1]!, /min-block-size:\s*0/);
  assert.match(marker[1]!, /block-size:\s*var\(--sone-marker\)/);
});

test('the gutter width in the stylesheet matches the one used to place it', () => {
  // The gutter is positioned from its right edge, so the code has to know how
  // wide it is. Two places holding one number drift; this notices.
  // readFileSync is already imported at the top of this file; ESM has no
  // require, which the first version of this test forgot.
  const source = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/BlockMenu.tsx'),
    'utf8',
  );
  const inCode = /const GUTTER_WIDTH = (\d+)/.exec(source)?.[1];
  const inCss = /\.block-gutter \{[^}]*inline-size:\s*(\d+)px/.exec(css)?.[1];

  assert.ok(inCode, 'GUTTER_WIDTH should be declared');
  assert.ok(inCss, '.block-gutter should set an explicit width');
  assert.equal(inCss, inCode, 'the stylesheet and the placement disagree');
});

test('narrow screens reserve room for the gutter', () => {
  // On a phone the content runs edge to edge, and without extra padding the
  // controls have nowhere to go but on top of the first line.
  // Read from the variable rather than from the rule, which now references it.
  // The first version of this test matched a literal rem value and broke the
  // moment the value was named — a check that only works while nothing is
  // refactored is not much of a check.
  const editorPadding = /--sone-text-indent:\s*([\d.]+)rem/.exec(css);
  const narrowPadding = /@media \(max-width: 60rem\)[\s\S]{0,200}?padding-inline-start:\s*(\d+)px/.exec(css);
  const gutterWidth = /\.block-gutter \{[^}]*inline-size:\s*(\d+)px/.exec(css);

  assert.ok(narrowPadding, 'narrow screens should reserve extra padding');
  assert.ok(gutterWidth, '.block-gutter should have a width');

  assert.ok(editorPadding, '--sone-text-indent should be defined in rem');
  const reserved = Number(narrowPadding[1]) + Number(editorPadding[1]) * 16;
  assert.ok(
    reserved >= Number(gutterWidth[1]),
    `only ${reserved}px reserved for a ${gutterWidth[1]}px gutter`,
  );
});

test('the title and the body share one text indent', () => {
  // The editor reserves space for list markers; the title did not, so the
  // heading sat 24px to the left of its own body text — a misalignment people
  // see without being able to name.
  assert.match(css, /\.ProseMirror \{[^}]*padding-inline-start:\s*var\(--sone-text-indent\)/);
  assert.match(css, /\.page-title \{[^}]*var\(--sone-text-indent\)/);
});

test('table styling does not depend on attributes the node view drops', () => {
  // Enabling column resizing installs prosemirror-tables' own node view, which
  // builds the table in JavaScript and never consults the schema's toDOM — so
  // `data-block` is absent from a rendered table, and a selector requiring it
  // matches nothing. A whole section of table styling was dead this way, and
  // the page showed a container with no borders and no header.
  const dead = [...css.matchAll(/table\[data-block=/g)];
  assert.equal(
    dead.length,
    0,
    'a table selector requires data-block, which the node view does not emit',
  );

  // And the styling has to exist at all.
  assert.match(css, /\.ProseMirror table \{[^}]*table-layout:\s*fixed/);
  assert.match(css, /\.ProseMirror \.tableWrapper/);
});

test('no control invents its own tap size', () => {
  // A hand-written 44px is a scale value that has drifted from the scale.
  const offenders = [...css.matchAll(/min-(?:height|block-size):\s*44px/g)];
  assert.equal(
    offenders.length,
    0,
    'use var(--sone-tap) so the size can be changed in one place',
  );
});

test('the caret label fades and the bar does not', () => {
  // A name beside a caret says "somebody is working here", and left on screen
  // it goes on saying that after they stopped. The bar stays: it says another
  // person is in the document, which remains true.
  assert.match(css, /\.sone-caret-label\s*\{[^}]*animation:/);
  assert.match(css, /@keyframes sone-caret-label-fade/);
  // Hovering brings it back, so the information is quiet rather than gone.
  assert.match(css, /\.ProseMirror-yjs-cursor:hover \.sone-caret-label/);
});
