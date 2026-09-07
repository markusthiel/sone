/**
 * The scale, and the density that moves it (ADR-0140).
 *
 * *„Dichte als Stufe"* was written down as step 3's leftover and could not have
 * been built where it stood, for a reason nothing was checking: **a third of the
 * interface's spacing did not go through the scale a density would move.**
 * Ninety-four `gap` and `padding` declarations were the scale's own numbers
 * typed out, so setting a denser scale would have tightened two hundred places
 * and left ninety-four where they were — and an interface that is *partly*
 * denser reads as broken rather than as compact.
 *
 * The scale section says as much about itself:
 *
 * > every control picked its own height and padding, some of them by accident,
 * > and the result reads as unfinished even when nothing is individually wrong.
 *
 * So the first test here is the precondition, and the rest are what a density
 * may not break.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

/** The steps, and what each is written as when somebody types it out instead. */
const STEPS: Record<string, string> = {
  '2px': '--sone-space-1',
  '4px': '--sone-space-2',
  '6px': '--sone-space-3',
  '8px': '--sone-space-4',
  '12px': '--sone-space-5',
  '16px': '--sone-space-6',
  '24px': '--sone-space-7',
};

/**
 * Declarations that are spacing *by definition*.
 *
 * Deliberately not every property whose value could be a step. `inline-size:
 * 2px` on a drop indicator is a hairline that happens to be two pixels, not the
 * first step of the scale — and a test that forbade it would be forbidding a
 * line for ever. A `gap` and a `padding` are distances between things and have
 * no other reading, which is what makes this checkable rather than a matter of
 * taste.
 */
const SPACING =
  /^\s*(gap|row-gap|column-gap|padding|padding-block|padding-inline|padding-block-start|padding-block-end|padding-inline-start|padding-inline-end):\s*([^;]+);/gm;

/** The values of a shorthand, splitting on spaces outside any brackets. */
function topLevelParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of value.trim()) {
    if (character === '(') depth++;
    if (character === ')') depth--;
    if (/\s/.test(character) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else current += character;
  }
  if (current) parts.push(current);
  return parts;
}

describe('the scale is the scale', () => {
  test('a distance is wholly on the scale or wholly off it', () => {
    /*
     * **The precondition for a density, and it is not "no numbers".**
     *
     * A density moves the scale. It can only move a declaration that is *made*
     * of the scale — so the failure is not a number, it is a **mixture**.
     * `padding: var(--sone-space-3) 10px` looks tidier than `6px 10px` and is
     * worse: under compact the first axis shrinks and the second does not, so
     * the box changes *proportion* rather than size. A field that gets narrower
     * without getting shorter reads as a mistake, where one that does not move
     * at all reads as a decision.
     *
     * Ninety-four declarations were wholly expressible as steps and written as
     * numbers, which is the other half of the same rule: a scale a third of the
     * interface ignores cannot be moved at all.
     *
     * Nineteen are wholly off it — `10px 12px`, `1px 6px` — and stay that way.
     * The scale's own note allows exactly that: *"anything between these is a
     * decision that has to justify itself."* They are what a future density has
     * to look at one at a time, with eyes on them.
     *
     * Zero is neither: `padding: 0 var(--sone-space-4)` is one distance and one
     * absence.
     */
    const typedOut: string[] = [];
    const mixed: string[] = [];

    for (const [line, , value] of css.matchAll(SPACING)) {
      // Split on spaces *outside* brackets: a `calc(var(a) + var(b))` is one
      // value however many names are inside it, and splitting on whitespace
      // would read it as three.
      const parts = topLevelParts(value).filter((part) => part !== '0');
      if (parts.length === 0) continue;
      const named = parts.filter((part) => part.includes('var(') || part.startsWith('calc('));
      const steps = parts.filter((part) => part in STEPS);

      if (named.length > 0 && named.length < parts.length) mixed.push(line.trim());
      else if (steps.length === parts.length) typedOut.push(line.trim());
    }

    assert.deepEqual(
      typedOut,
      [],
      `${typedOut.length} distances are the scale written as numbers:\n  ${typedOut.slice(0, 8).join('\n  ')}`,
    );
    assert.deepEqual(
      mixed,
      [],
      `${mixed.length} distances are half on the scale, so a density would distort them:\n  ${mixed.slice(0, 8).join('\n  ')}`,
    );
  });

  test('and the steps are declared once, in order', () => {
    // A scale whose values are not increasing is not a scale, and a density
    // that collapsed two steps into one value would have quietly removed one.
    const declared = [...css.matchAll(/--sone-space-(\d): (\d+)px;/g)].map(([, step, px]) => ({
      step: Number(step),
      px: Number(px),
    }));
    assert.equal(declared.length >= 7, true, 'all seven, at least once');

    const base = declared.slice(0, 7);
    for (let at = 1; at < base.length; at++) {
      assert.ok(base[at]!.px > base[at - 1]!.px, `step ${base[at]!.step} is not larger than the one below`);
    }
  });
});

describe('what a density may not do', () => {
  /** One density block, as declared. */
  const blockFor = (density: string): string =>
    new RegExp(`:root\\[data-density='${density}'\\] \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  test('every density fills the same names', () => {
    /*
     * The lesson of the three dark themes (ADR-0135): a token set in one and
     * forgotten in the other shows nothing wrong until somebody switches, and
     * then shows a value from the level above that is almost right.
     */
    const names = (body: string) => [...body.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]).sort();
    const compact = names(blockFor('compact'));
    assert.ok(compact.length > 0, 'compact declares something');
    assert.deepEqual(names(blockFor('comfortable')), compact, 'and comfortable declares the same');
  });

  test('the steps stay in order in every density', () => {
    // Compact takes each larger space down to the step below it. That is a step
    // by construction — and it stops being one the moment two of them meet.
    for (const density of ['compact', 'comfortable']) {
      const body = blockFor(density);
      const moved = [...body.matchAll(/--sone-space-(\d): (\d+)px;/g)].map(([, s, px]) => ({
        step: Number(s),
        px: Number(px),
      }));
      for (let at = 1; at < moved.length; at++) {
        assert.ok(
          moved[at]!.px > moved[at - 1]!.px,
          `${density}: step ${moved[at]!.step} is not larger than the one below it`,
        );
      }
      // And whole pixels, which is why this is a shift along the scale rather
      // than a multiplier: `calc(2px * 0.75)` is a hairline the browser rounds
      // somewhere different on every zoom level.
      for (const one of moved) assert.equal(one.px, Math.round(one.px));
    }
  });

  test('the tap target is not a step, and no density moves it', () => {
    /*
     * 44px is the smallest target reliably hittable with a thumb — a floor from
     * outside this design rather than a taste. A density that shrank it would
     * be a density that makes the interface unusable rather than tighter.
     */
    for (const density of ['compact', 'comfortable']) {
      assert.doesNotMatch(blockFor(density), /--sone-tap:/, `${density} moves the tap target`);
    }
    assert.match(css, /--sone-tap: 44px;/);
  });

  test('and compact stops where a finger is the pointer', () => {
    /*
     * The better half of the same rule, and the collection table wrote it
     * first: *"a tap target is a tap target: on a touch device the smallest
     * level still has to be hittable, so compact stops shrinking where a finger
     * is the pointer."*
     *
     * It is also why this setting belongs to the browser rather than the
     * account — the browser is where the pointer is.
     */
    const coarse = /@media \(pointer: coarse\) \{\s*:root\[data-density='compact'\] \{([^}]*)\}/.exec(
      css,
    )?.[1];
    assert.ok(coarse, 'compact is relaxed on a coarse pointer');
    assert.match(coarse, /--sone-control-lg:/);
  });

  test('a table’s rows are the scale, so a density can reach them', () => {
    // They were 34, 26 and 44 — `--sone-control-lg`, `--sone-control` and
    // `--sone-tap` written as numbers, which made a collection the one part of
    // the interface a density could not touch.
    // The rule that sets the three custom properties, not the first block that
    // happens to open with this selector.
    const rows = /\.collection-table \{[^}]*--row-control: ([^;]+);/.exec(css)?.[1] ?? '';
    assert.equal(rows.trim(), 'var(--sone-control-lg)');
    assert.doesNotMatch(css, /--row-control: \d+px/, 'no row height is a number');
  });
});
