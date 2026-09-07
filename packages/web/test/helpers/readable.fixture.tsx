/**
 * One of every shape the i18n guard is supposed to see (ADR-0148).
 *
 * Three of these hid from the regular expressions that came before it, one per
 * round: a paragraph across three lines, a ternary in a button, and a label
 * written after `{' '}`. A guard that has never been shown a string it must
 * catch is a guard nobody has tested — so this file is the thing it must catch,
 * and `i18n.test.ts` reads it back.
 *
 * It renders nothing. `t` is a stub with the shape of the real one, because
 * what matters here is the syntax and not where the words come from.
 */

import type { ReactElement } from 'react';

const t = (key: string, values?: Record<string, unknown>): string => `${key}${values ? '' : ''}`;
const busy = false;
const count = 2;
const name: string | null = null;

export function Fixture(): ReactElement {
  return (
    <div>
      {/* Text between tags, across more than one line. */}
      <p>
        A sentence written across
        two lines.
      </p>

      {/* A ternary in text position: neither branch follows a `>`. */}
      <button type="button">{busy ? 'Working…' : 'Do the thing'}</button>

      {/* A label after an explicit space, which is text after a `}`. */}
      <label>
        <input type="checkbox" />{' '}
        Something switchable
      </label>

      {/* A template with its own words in it. */}
      <span>{`${count} things counted`}</span>

      {/* The right side of an `&&`, which is what is drawn. */}
      <span>{count > 1 && 'More than one'}</span>

      {/* A fallback for something missing. */}
      <span>{name ?? 'No name yet'}</span>

      {/* An attribute somebody reads without seeing it. */}
      <button type="button" aria-label="Close the panel" />

      {/* And the ones that must NOT be reported: a translated string, a key, a
          class, and a value that is not prose. */}
      <p title={t('panel.close')}>{t('panel.body', { count })}</p>
      <p className="muted" data-kind="page">
        {t('panel.note')}
      </p>
      <span>{' '}</span>
      <span>{count}</span>
    </div>
  );
}

/** A label held in a data structure rather than in markup. */
export const TABS = [
  { id: 'outline', label: 'Outline' },
  { id: 'people', label: t('panel.people') },
];
