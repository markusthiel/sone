/**
 * SONE web — a list that belongs to a field, and the keys that reach it
 * (ADR-0142).
 *
 * Six places put a list of choices under something somebody is typing into: the
 * person picker, the search panel's two fields, the tag field, and the `@` menu
 * in both a comment and the editor. **They had three different answers to the
 * same question, and four of them had none.**
 *
 * The answer that was already right is the slash menu's, written first and in
 * the other package:
 *
 * > the selected index has to live in one place or the keyboard and the list
 * > disagree about what is highlighted
 *
 * — and its renderer says the rest of it out loud: `role="listbox"`,
 * `role="option"`, `aria-selected`, `aria-activedescendant`, and the highlight
 * scrolled into view when the keyboard moves past the edge of the box.
 *
 * The slash menu keeps its index in plugin state, for a reason this hook cannot
 * improve on: `@sone/editor` must work without React (ADR-0016). So it stays as
 * it is, and this is the same shape for the six lists that *are* React's.
 *
 * ## What it does not own
 *
 * **Whether the list is open.** That is the caller's query, and every caller
 * decides it differently — two characters typed, an `@` under the caret, a
 * request that has come back. A hook that owned it would need to be told all
 * of that anyway.
 *
 * **What a key means when the list did not want it.** `handleKey` answers
 * *"was that mine?"* and nothing else. Enter with nothing highlighted still
 * submits the person picker's typed address (ADR-0119), still sends a comment,
 * and Escape still belongs to whoever knows what closing means here.
 */

import { useEffect, useId, useRef, useState } from 'react';

export interface ChoiceList {
  /** Which choice is current, or -1 when there is nothing to choose. */
  index: number;
  /** The id of the current option, for `aria-activedescendant`. */
  activeId: string | undefined;
  /**
   * Attach to the element that scrolls, so a highlight cannot leave the box.
   *
   * A callback rather than an object ref, because the six lists are a `ul`, a
   * `div` and a `nav`'s worth of different elements, and one typed object ref
   * would fit exactly one of them.
   */
  listRef: (element: HTMLElement | null) => void;
  /**
   * For a single-line field with a popup list — the ARIA combobox contract.
   *
   * Not for a textarea or a contenteditable: a composer that happens to show a
   * mention list is not a combobox, and saying so would tell a screen reader
   * the whole box is a chooser. Those callers put `activeId` on the list
   * itself, which is what the slash menu does.
   */
  fieldProps: {
    role: 'combobox';
    'aria-expanded': boolean;
    'aria-controls': string;
    'aria-activedescendant': string | undefined;
    'aria-autocomplete': 'list';
    autoComplete: 'off';
  };
  listProps: { id: string; role: 'listbox' };
  optionProps: (at: number) => {
    id: string;
    role: 'option';
    'aria-selected': boolean;
    /**
     * Out of the tab order, on purpose.
     *
     * These are buttons, so Tab used to reach them — the only key that did, and
     * the wrong one: Tab means "leave this field", and a field that hands its
     * focus to its own suggestions runs whatever it does on blur first. The
     * field is one tab stop and the list hangs under it.
     */
    tabIndex: -1;
    'data-selected': 'true' | undefined;
    onPointerEnter: () => void;
  };
  /** Returns true when the key belonged to the list. */
  handleKey: (event: { key: string; preventDefault: () => void }) => boolean;
  /** Put the highlight back at the top. */
  reset: () => void;
}

export function useChoiceList({
  count,
  onChoose,
  resetOn,
}: {
  count: number;
  onChoose: (at: number) => void;
  /** Changing this puts the highlight back at the top — usually the query. */
  resetOn?: unknown;
}): ChoiceList {
  const [raw, setRaw] = useState(0);
  const listEl = useRef<HTMLElement | null>(null);
  // Colons are legal in an id and awkward in every selector that goes looking
  // for one, and these ids are read back by tests and by a screen reader.
  const base = useId().replace(/:/g, '');

  /*
   * Clamped rather than trusted.
   *
   * A list shrinks under a highlight all the time — another keystroke, a slower
   * request landing. Left alone, the highlight points past the end and Enter
   * chooses nothing while the list looks perfectly normal.
   */
  const index = count === 0 ? -1 : Math.min(raw, count - 1);

  useEffect(() => {
    setRaw(0);
  }, [resetOn]);

  // The lesson of the slash menu: a highlight below the fold moves invisibly,
  // and a list somebody is arrowing through is exactly the case where it does.
  useEffect(() => {
    listEl.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView?.({
      block: 'nearest',
    });
  }, [index]);

  const optionId = (at: number): string => `${base}-choice-${at}`;

  return {
    index,
    activeId: index < 0 ? undefined : optionId(index),
    listRef: (element) => {
      listEl.current = element;
    },
    fieldProps: {
      role: 'combobox',
      'aria-expanded': count > 0,
      'aria-controls': `${base}-choices`,
      'aria-activedescendant': index < 0 ? undefined : optionId(index),
      'aria-autocomplete': 'list',
      autoComplete: 'off',
    },
    listProps: { id: `${base}-choices`, role: 'listbox' },
    optionProps: (at: number) => ({
      id: optionId(at),
      role: 'option',
      'aria-selected': at === index,
      tabIndex: -1,
      'data-selected': at === index ? 'true' : undefined,
      onPointerEnter: () => setRaw(at),
    }),
    handleKey: (event) => {
      if (count === 0) return false;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setRaw((index + 1) % count);
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setRaw((index - 1 + count) % count);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (index < 0) return false;
        event.preventDefault();
        onChoose(index);
        return true;
      }
      return false;
    },
    reset: () => setRaw(0),
  };
}
