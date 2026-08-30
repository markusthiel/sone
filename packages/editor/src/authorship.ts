/**
 * SONE editor — which client wrote which characters.
 *
 * The pure half of highlighting, kept apart from the drawing on purpose. Every
 * position here is an index *within one Y.XmlText*, which is a fact about the
 * document and not about the editor; turning those into editor positions needs
 * the live binding and is done in the plugin.
 *
 * Splitting it this way is what makes the risky part testable. A highlight in
 * the wrong place is worse than no highlight — it makes a confident false claim
 * about who wrote a sentence — so the arithmetic is tested against plain Yjs
 * documents where the expected answer can be written down by hand.
 *
 * ## How Yjs stores this
 *
 * A Y.Text is a linked list of items. Each carries the id of the client that
 * created it and a piece of content, and an item is never split by a later edit
 * from the same client — typing continuously produces one long item, while
 * typing into the middle of somebody else's sentence splits theirs in two.
 *
 * So the ranges fall out of walking the list: keep a running index, add each
 * item's length, and remember which client owned it. Deleted items are skipped
 * and contribute no length, because they are not in the text any more.
 */

import * as Y from 'yjs';

export interface AuthoredRange {
  /** Index within the text, counting only what is still present. */
  from: number;
  /** Exclusive. */
  to: number;
  /** The Yjs client that created these characters. */
  client: number;
}

/**
 * The authored ranges of one text, in order.
 *
 * Adjacent ranges by the same client are merged. Yjs splits items for reasons
 * that have nothing to do with authorship — a formatting mark, a concurrent
 * edit elsewhere — and a highlight broken into pieces at those points would
 * show seams where the writing has none.
 */
export function authoredRanges(text: Y.Text | Y.XmlText): AuthoredRange[] {
  const ranges: AuthoredRange[] = [];
  let index = 0;

  // `_start` is the head of the item list. Reading it directly is reaching past
  // the public API, and the alternative — reconstructing authorship from a
  // delta — does not carry client ids at all.
  let item = text._start;
  while (item !== null) {
    // A formatting mark reports a length of 1 and occupies no characters.
    //
    // Skipped before anything else, because counting it moved every range after
    // the first bold word along by one — the test that says so was written
    // expecting this to be free, and it was not.
    if (!item.deleted && !(item.content instanceof Y.ContentFormat)) {
      const length = item.length;
      if (length > 0 && item.content instanceof Y.ContentString) {
        const previous = ranges[ranges.length - 1];
        if (previous && previous.client === item.id.client && previous.to === index) {
          previous.to = index + length;
        } else {
          ranges.push({ from: index, to: index + length, client: item.id.client });
        }
        index += length;
      } else if (length > 0) {
        // Content that occupies positions but is not text — an embed. It takes
        // up room in the index, and attributing it is out of scope for a text
        // highlight.
        index += length;
      }
    }
    item = item.right;
  }

  return ranges;
}

/**
 * Keep only the ranges written by one of these clients.
 *
 * A person is several clients: a client id is per browser session, so somebody
 * who wrote on three days has three (ADR-0022).
 */
export function rangesForClients(
  ranges: readonly AuthoredRange[],
  clients: ReadonlySet<number>,
): AuthoredRange[] {
  const kept: AuthoredRange[] = [];

  for (const range of ranges) {
    if (!clients.has(range.client)) continue;
    // Merged again after filtering: two sessions of the same person either side
    // of a gap belong to one highlight, and the seam between them says nothing
    // a reader would want to know.
    const previous = kept[kept.length - 1];
    if (previous && previous.to === range.from) previous.to = range.to;
    else kept.push({ ...range });
  }

  return kept;
}

/**
 * Walk every text in a fragment, in document order.
 *
 * The callback receives each text and its ranges. Yielding the text itself
 * rather than a position is deliberate: only the caller has the binding that
 * turns an index inside a text into a position in the editor.
 */
export function eachAuthoredText(
  fragment: Y.XmlFragment,
  visit: (text: Y.XmlText, ranges: AuthoredRange[]) => void,
): void {
  const walk = (node: Y.XmlFragment | Y.XmlElement | Y.XmlText): void => {
    if (node instanceof Y.XmlText) {
      const ranges = authoredRanges(node);
      if (ranges.length > 0) visit(node, ranges);
      return;
    }

    for (const child of node.toArray()) {
      if (
        child instanceof Y.XmlText ||
        child instanceof Y.XmlElement ||
        child instanceof Y.XmlFragment
      ) {
        walk(child);
      }
    }
  };

  walk(fragment);
}

/**
 * Which people have written in this document.
 *
 * The question the margin asks before it draws anything: a page written by one
 * person needs no marks, because every block is theirs and a column of the same
 * initial says only that they were the one writing.
 *
 * Client ids rather than people, because that is what the ranges carry — one
 * person on two devices counts twice here, which is why the caller maps them
 * through the attribution table before deciding.
 */
export function writingClients(fragment: Y.XmlFragment): Set<number> {
  const seen = new Set<number>();
  eachAuthoredText(fragment, (_text, ranges) => {
    for (const range of ranges) seen.add(range.client);
  });
  return seen;
}
