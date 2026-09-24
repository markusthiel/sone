/**
 * What the block menu says about a locked block (ADR-0194).
 *
 * Reported as: *„Ich habe hier einen Info-Block eingesetzt den ich jetzt nicht
 * mehr bearbeiten kann. Weder Farben noch Typ ändern klappt. Es bleibt blau."*
 *
 * The block was locked. The refusal is right — `blockLock`'s filter cannot let
 * a colour through and still be a lock — and the editor's own test now pins it.
 * What was wrong is this menu: it offered every setting, and each one did
 * nothing at all.
 *
 * Read from the source rather than mounted: the menu needs an `EditorView`, a
 * gutter position and a layout, and jsdom has none of those. The three things
 * worth holding are structural and visible here.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { en } from '../src/i18n/messages.en.ts';
import { codeOf, stylesOf } from './helpers/source.ts';

const source = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));

test('the padlock shows which way it is standing', () => {
  // One control that only ever looked the same left somebody guessing whether
  // the block already was locked. The label flipped — in a tooltip, which is
  // where nobody looks before clicking.
  assert.match(source, /action\.id === 'lock' && lockedHere \? 'current' : ''/);
  assert.match(source, /aria-pressed=\{action\.id === 'lock' \? lockedHere : undefined\}/);

  const css = stylesOf(new URL('../src/styles.css', import.meta.url));
  assert.match(css, /\.block-menu-action\.current \{/);

  /*
   * And it is red, not the hover grey every other button in the row takes
   * (ADR-0195). In `--sone-danger`, so the dark theme follows without a second
   * rule — and with its own hover rule, because `:hover:not(:disabled)` is more
   * specific and dropped the padlock back to grey exactly when somebody
   * reached for it, which looks like the unlock already happened.
   */
  const locked = /\.block-menu-action\.current \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(locked, /--sone-danger/);
  assert.doesNotMatch(locked, /--sone-bg-hover/);
  assert.match(css, /\.block-menu-action\.current:hover:not\(:disabled\) \{[^}]*--sone-danger/);
});

test('moving, duplicating and deleting are not offered on a locked block', () => {
  /*
   * The dry run above them asks the *command* whether it would act, and every
   * one of these would: what refuses them is `filterTransaction` in
   * `blockLock`, one layer on, where a menu cannot ask. So the row looked
   * live and did nothing.
   *
   * Unlocking stays, or a locked block could never be unlocked from here —
   * the same trap the filter itself fell into once.
   */
  assert.match(source, /disabled=\{!possible \|\| \(lockedHere && action\.id !== 'lock'\)\}/);
});

test('the settings are replaced by a sentence, not greyed out', () => {
  // Forty disabled controls are noise. This menu already says elsewhere that a
  // section of controls with no effect teaches people the panel is decoration.
  assert.match(source, /\{lockedHere && <p className="block-menu-note">\{t\('block\.lockedNote'\)\}<\/p>\}/);
  assert.ok('block.lockedNote' in en, 'the sentence has a message');

  // Every section that writes to the block is behind the same condition.
  for (const guarded of [
    /\{!lockedHere && range\.node\.type\.name === 'video'/,
    /\{!lockedHere && range\.node\.type\.name === 'file'/,
    /\{!lockedHere &&\s*\n\s*\(range\.node\.type\.name === 'image'/,
    /\{!lockedHere && \(\s*\n\s*<BlockAppearance/,
    /\{!lockedHere && isInTable\(view\.state\)/,
  ]) {
    assert.match(source, guarded);
  }

  // And the one thing that changes nothing about the document stays: copying
  // the block's address works on a locked block, because it is not an edit.
  assert.doesNotMatch(source, /!lockedHere && blockId !== ''/);
});
