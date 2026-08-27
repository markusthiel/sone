/**
 * SONE — reading and writing the block tree.
 *
 * The block tree lives as nested Y.XmlElements inside one Y.XmlFragment per
 * page (ADR-0015). These helpers are the only sanctioned way to traverse or
 * build it, so the editor, the materialiser and the tests cannot drift apart
 * on details like how props are encoded or how depth is counted.
 *
 * Everything here is defensive. A document is user input that may have been
 * written by an older client, a third-party block type, or something buggy. A
 * malformed element degrades that element and nothing else.
 */

import * as Y from 'yjs';

import { BLOCK_ATTRS, CONTAINER_BLOCK_TYPES, DOC_KEYS } from './docSchema.js';

/** Guard against a malformed document causing unbounded recursion. */
export const MAX_BLOCK_DEPTH = 32;

export interface TreeBlock {
  id: string;
  type: string;
  /** Null for a top-level block. */
  parentId: string | null;
  /** Depth-first ordinal within the page, starting at 0. */
  position: number;
  depth: number;
  props: Record<string, unknown>;
  /** Inline text, flattened. Empty for atoms and pure containers. */
  text: string;
  /** Ids of direct children, in order. */
  childIds: string[];
}

export interface TreeReadResult {
  blocks: TreeBlock[];
  warnings: string[];
}

/** The page body fragment. Created on first access, as Yjs does. */
export function pageContent(doc: Y.Doc): Y.XmlFragment {
  return doc.get(DOC_KEYS.content, Y.XmlFragment) as Y.XmlFragment;
}

function parseProps(raw: unknown, warnings: string[], id: string): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw !== 'string') {
    warnings.push(`block ${id}: props attribute is not a string`);
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push(`block ${id}: props is not an object`);
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    warnings.push(`block ${id}: props is not valid JSON`);
    return {};
  }
}

/**
 * Flatten the inline text directly inside an element.
 *
 * Descends through inline marks (a link wrapping text) but stops at nested
 * *block* elements, whose text belongs to those blocks. Without that boundary,
 * a container's text would duplicate every descendant's and the search index
 * would score it many times over.
 */
function inlineText(element: Y.XmlElement, depth = 0): string {
  if (depth > MAX_BLOCK_DEPTH) return '';
  const parts: string[] = [];

  for (let i = 0; i < element.length; i++) {
    const child: unknown = element.get(i);
    if (child instanceof Y.XmlText) {
      parts.push(child.toString());
    } else if (child instanceof Y.XmlElement) {
      // A child carrying a block id is a block, not inline content.
      if (child.getAttribute(BLOCK_ATTRS.id)) continue;
      parts.push(inlineText(child, depth + 1));
    }
  }
  return parts.join('');
}

/**
 * Walk a page's block tree depth-first.
 *
 * Depth-first order is the reading order, which is what every consumer wants:
 * the materialiser assigns positions from it, and the search index concatenates
 * in it.
 */
export function readBlockTree(doc: Y.Doc): TreeReadResult {
  const warnings: string[] = [];
  const blocks: TreeBlock[] = [];
  let position = 0;

  const visit = (
    element: Y.XmlElement,
    parentId: string | null,
    depth: number,
  ): string | null => {
    if (depth > MAX_BLOCK_DEPTH) {
      warnings.push(`block tree exceeds depth ${MAX_BLOCK_DEPTH}; subtree ignored`);
      return null;
    }

    const id = element.getAttribute(BLOCK_ATTRS.id);
    if (!id) {
      // An element with no id is inline content that reached this level by
      // mistake, or a node type the editor schema allows but SONE does not
      // model. Skipped, not fatal.
      warnings.push(`element <${element.nodeName}> has no block id; skipped`);
      return null;
    }

    const type = element.nodeName;
    const block: TreeBlock = {
      id,
      type,
      parentId,
      position: position++,
      depth,
      props: parseProps(element.getAttribute(BLOCK_ATTRS.props), warnings, id),
      text: inlineText(element),
      childIds: [],
    };
    blocks.push(block);

    if (CONTAINER_BLOCK_TYPES.has(type) || hasBlockChildren(element)) {
      for (let i = 0; i < element.length; i++) {
        const child: unknown = element.get(i);
        if (child instanceof Y.XmlElement && child.getAttribute(BLOCK_ATTRS.id)) {
          const childId = visit(child, id, depth + 1);
          if (childId) block.childIds.push(childId);
        }
      }
    }

    return id;
  };

  const fragment = pageContent(doc);
  for (let i = 0; i < fragment.length; i++) {
    const child: unknown = fragment.get(i);
    if (child instanceof Y.XmlElement) {
      visit(child, null, 0);
    } else if (child instanceof Y.XmlText && child.toString().trim() !== '') {
      // Text at the top level of a page has no owning block, so it cannot be
      // materialised or edited coherently. Reported so it is visible.
      warnings.push('loose text at the top level of the page; not materialised');
    }
  }

  return { blocks, warnings };
}

/**
 * Does this element contain block children?
 *
 * Checked in addition to the container-type set so a third-party block type
 * that nests still materialises correctly without having to register itself
 * first.
 */
function hasBlockChildren(element: Y.XmlElement): boolean {
  for (let i = 0; i < element.length; i++) {
    const child: unknown = element.get(i);
    if (child instanceof Y.XmlElement && child.getAttribute(BLOCK_ATTRS.id)) {
      return true;
    }
  }
  return false;
}

// --- writing ---------------------------------------------------------------

export interface NewBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  text?: string;
  children?: NewBlock[];
}

/**
 * Build a Y.XmlElement for a block.
 *
 * Used by the editor when inserting, by importers, and by tests. Props are
 * omitted rather than written as `{}` when empty, keeping documents smaller
 * and diffs readable.
 */
export function buildBlock(block: NewBlock): Y.XmlElement {
  const element = new Y.XmlElement(block.type);
  element.setAttribute(BLOCK_ATTRS.id, block.id);

  if (block.props && Object.keys(block.props).length > 0) {
    element.setAttribute(BLOCK_ATTRS.props, JSON.stringify(block.props));
  }

  const children: Array<Y.XmlElement | Y.XmlText> = [];
  if (block.text !== undefined && block.text !== '') {
    children.push(new Y.XmlText(block.text));
  }
  for (const child of block.children ?? []) {
    children.push(buildBlock(child));
  }
  if (children.length > 0) element.insert(0, children);

  return element;
}

/** Append blocks to the end of a page. */
export function appendBlocks(doc: Y.Doc, blocks: NewBlock[]): void {
  const fragment = pageContent(doc);
  doc.transact(() => {
    fragment.insert(
      fragment.length,
      blocks.map((b) => buildBlock(b)),
    );
  });
}

/** Replace a page's entire body. Used by importers and tests, not by the editor. */
export function setPageBlocks(doc: Y.Doc, blocks: NewBlock[]): void {
  const fragment = pageContent(doc);
  doc.transact(() => {
    if (fragment.length > 0) fragment.delete(0, fragment.length);
    fragment.insert(
      0,
      blocks.map((b) => buildBlock(b)),
    );
  });
}

/**
 * Find a block element by id.
 *
 * Linear in document size. Fine for the occasional lookup; the editor works
 * from ProseMirror positions rather than calling this per keystroke.
 */
export function findBlockElement(doc: Y.Doc, blockId: string): Y.XmlElement | null {
  const search = (container: Y.XmlFragment | Y.XmlElement, depth: number): Y.XmlElement | null => {
    if (depth > MAX_BLOCK_DEPTH) return null;
    for (let i = 0; i < container.length; i++) {
      const child: unknown = container.get(i);
      if (!(child instanceof Y.XmlElement)) continue;
      if (child.getAttribute(BLOCK_ATTRS.id) === blockId) return child;
      const found = search(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return search(pageContent(doc), 0);
}

/** Merge props into a block, leaving unlisted keys untouched. */
export function updateBlockProps(
  doc: Y.Doc,
  blockId: string,
  patch: Record<string, unknown>,
): boolean {
  const element = findBlockElement(doc, blockId);
  if (!element) return false;

  const warnings: string[] = [];
  const current = parseProps(element.getAttribute(BLOCK_ATTRS.props), warnings, blockId);
  const next = { ...current, ...patch };

  doc.transact(() => {
    if (Object.keys(next).length === 0) {
      element.removeAttribute(BLOCK_ATTRS.props);
    } else {
      element.setAttribute(BLOCK_ATTRS.props, JSON.stringify(next));
    }
  });
  return true;
}
