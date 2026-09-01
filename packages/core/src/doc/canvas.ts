/**
 * SONE core — a canvas and the things on it (ADR-0043).
 *
 * The document's other shapes are sequences: a body is a list of blocks, a
 * collection is a list of rows. A canvas is not. Two items on it have no order
 * at all — they have positions — and everything here follows from that.
 *
 * So the items live in a `Y.Map` keyed by id, and each item is itself a `Y.Map`.
 * Moving something sets `x` and `y` on one key; two people moving two different
 * things write two keys and never meet. Two people moving the *same* thing is
 * last-writer-wins on that key, which is the honest outcome — there is no merge
 * of "here" and "there" that is not simply one of them.
 */

import * as Y from 'yjs';

import { DOC_KEYS } from './docSchema.js';
import { generateKeyBetween } from '../order/fractionalIndex.js';

/** What an item is. Its other keys depend on which. */
export const CANVAS_ITEM_KINDS = ['text', 'image', 'path'] as const;
export type CanvasItemKind = (typeof CANVAS_ITEM_KINDS)[number];

export const CANVAS_KEYS = {
  kind: 'kind',
  x: 'x',
  y: 'y',
  /** Width and height, in canvas units. A path measures its own. */
  w: 'w',
  h: 'h',
  /**
   * Stacking, as a fractional index rather than a number or an array position.
   *
   * "Bring to front" is then one key written on one item — no renumbering, and
   * no argument with somebody reordering something else at the same time. The
   * same instrument the tree uses for siblings (ADR-0006).
   */
  z: 'z',
  /** A text item's words, as Y.Text so two people typing in one box merge. */
  text: 'text',
  /** An image item's file (ADR-0029). The workspace's file, not a copy. */
  fileId: 'fileId',
  /** A path item's points, as a flat [x, y, x, y, …] array. */
  points: 'points',
  /** A path's colour and thickness. */
  colour: 'colour',
  width: 'width',
} as const;

export interface CanvasItem {
  id: string;
  kind: CanvasItemKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: string;
  text?: string;
  fileId?: string;
  points?: number[];
  colour?: string;
  width?: number;
}

/** How large a canvas may get, so one page cannot become the whole database. */
export const MAX_CANVAS_ITEMS = 2000;
/** Points in one stroke. A long scribble is fine; an infinite one is a bug. */
export const MAX_PATH_POINTS = 4000;

export function canvasMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(DOC_KEYS.canvas);
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Read one item out of the document, or null if it is not one. */
export function readItem(id: string, map: Y.Map<unknown>): CanvasItem | null {
  const kind = map.get(CANVAS_KEYS.kind);
  if (typeof kind !== 'string' || !(CANVAS_ITEM_KINDS as readonly string[]).includes(kind)) {
    // An item of a kind this version does not know is skipped rather than
    // guessed at — and, unlike a block, skipping does not delete it: it stays in
    // the map for a client that does know (ADR-0043).
    return null;
  }

  const text = map.get(CANVAS_KEYS.text);
  const points = map.get(CANVAS_KEYS.points);

  return {
    id,
    kind: kind as CanvasItemKind,
    x: asNumber(map.get(CANVAS_KEYS.x)),
    y: asNumber(map.get(CANVAS_KEYS.y)),
    w: asNumber(map.get(CANVAS_KEYS.w), 160),
    h: asNumber(map.get(CANVAS_KEYS.h), 80),
    z: typeof map.get(CANVAS_KEYS.z) === 'string' ? (map.get(CANVAS_KEYS.z) as string) : 'a0',
    ...(text instanceof Y.Text ? { text: text.toString() } : {}),
    ...(typeof map.get(CANVAS_KEYS.fileId) === 'string'
      ? { fileId: map.get(CANVAS_KEYS.fileId) as string }
      : {}),
    ...(Array.isArray(points) ? { points: points.filter((n) => typeof n === 'number') } : {}),
    ...(typeof map.get(CANVAS_KEYS.colour) === 'string'
      ? { colour: map.get(CANVAS_KEYS.colour) as string }
      : {}),
    ...(typeof map.get(CANVAS_KEYS.width) === 'number'
      ? { width: map.get(CANVAS_KEYS.width) as number }
      : {}),
  };
}

/** Everything on the canvas, back to front. */
export function readCanvas(doc: Y.Doc): CanvasItem[] {
  const items: CanvasItem[] = [];
  canvasMap(doc).forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    const item = readItem(id, value);
    if (item) items.push(item);
  });
  // By the fractional index, and by id where two items somehow share one — a
  // stable order matters more than which of the two is on top.
  return items.sort((a, b) => (a.z === b.z ? a.id.localeCompare(b.id) : a.z < b.z ? -1 : 1));
}

/** The index that puts something in front of everything now on the canvas. */
export function frontIndex(doc: Y.Doc): string {
  const items = readCanvas(doc);
  const last = items[items.length - 1];
  return generateKeyBetween(last ? last.z : null, null);
}

export interface NewItem {
  id: string;
  kind: CanvasItemKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
  fileId?: string;
  points?: number[];
  colour?: string;
  width?: number;
}

/**
 * Put something on the canvas.
 *
 * In one transaction, so it arrives on another screen as one item rather than
 * as a position that briefly has nothing in it.
 */
export function addItem(doc: Y.Doc, item: NewItem): void {
  const map = canvasMap(doc);
  if (map.size >= MAX_CANVAS_ITEMS) return;

  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set(CANVAS_KEYS.kind, item.kind);
    entry.set(CANVAS_KEYS.x, item.x);
    entry.set(CANVAS_KEYS.y, item.y);
    entry.set(CANVAS_KEYS.w, item.w ?? 200);
    entry.set(CANVAS_KEYS.h, item.h ?? 80);
    entry.set(CANVAS_KEYS.z, frontIndex(doc));

    if (item.kind === 'text') {
      const text = new Y.Text();
      if (item.text) text.insert(0, item.text);
      entry.set(CANVAS_KEYS.text, text);
    }
    if (item.fileId) entry.set(CANVAS_KEYS.fileId, item.fileId);
    if (item.points) {
      entry.set(CANVAS_KEYS.points, item.points.slice(0, MAX_PATH_POINTS));
    }
    if (item.colour) entry.set(CANVAS_KEYS.colour, item.colour);
    if (item.width !== undefined) entry.set(CANVAS_KEYS.width, item.width);

    map.set(item.id, entry);
  });
}

/** Move something. Two numbers on one key, which is the whole point. */
export function moveItem(doc: Y.Doc, id: string, x: number, y: number): void {
  const entry = canvasMap(doc).get(id);
  if (!(entry instanceof Y.Map)) return;
  doc.transact(() => {
    entry.set(CANVAS_KEYS.x, x);
    entry.set(CANVAS_KEYS.y, y);
  });
}

/**
 * Move several things by the same amount, in one transaction.
 *
 * One transaction rather than a loop of `moveItem`, and the difference is
 * visible on the other screen: five separate moves arrive as five updates and
 * are drawn one after another, so a group crawls across somebody else's board
 * instead of moving. It is also what makes undo treat the drag as one act.
 *
 * By a delta rather than by positions, because that is what a drag is — and
 * because it means two people dragging two overlapping groups still each move
 * their own by their own amount.
 */
export function moveItems(doc: Y.Doc, ids: readonly string[], dx: number, dy: number): void {
  const map = canvasMap(doc);
  doc.transact(() => {
    for (const id of ids) {
      const entry = map.get(id);
      if (!(entry instanceof Y.Map)) continue;
      entry.set(CANVAS_KEYS.x, asNumber(entry.get(CANVAS_KEYS.x)) + dx);
      entry.set(CANVAS_KEYS.y, asNumber(entry.get(CANVAS_KEYS.y)) + dy);
    }
  });
}

/** Resize something. */
export function resizeItem(doc: Y.Doc, id: string, w: number, h: number): void {
  const entry = canvasMap(doc).get(id);
  if (!(entry instanceof Y.Map)) return;
  doc.transact(() => {
    entry.set(CANVAS_KEYS.w, Math.max(24, w));
    entry.set(CANVAS_KEYS.h, Math.max(24, h));
  });
}

/** Bring something to the front. One key, no renumbering. */
export function bringToFront(doc: Y.Doc, id: string): void {
  const entry = canvasMap(doc).get(id);
  if (!(entry instanceof Y.Map)) return;
  const index = frontIndex(doc);
  doc.transact(() => entry.set(CANVAS_KEYS.z, index));
}

export function removeItem(doc: Y.Doc, id: string): void {
  doc.transact(() => canvasMap(doc).delete(id));
}

/** The text on a canvas, for the search index — see ADR-0043 on the order. */
export function canvasText(doc: Y.Doc): string {
  return readCanvas(doc)
    .filter((item) => item.kind === 'text' && item.text)
    // Top to bottom, then left to right. A canvas has no reading order; this is
    // a fiction, and it is the fiction everybody already has.
    .sort((a, b) => (Math.abs(a.y - b.y) > 8 ? a.y - b.y : a.x - b.x))
    .map((item) => item.text)
    .join('\n');
}
