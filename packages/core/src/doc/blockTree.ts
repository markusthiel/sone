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

import { authorsByClient } from './attribution.js';
import { BLOCK_ATTRS, DOC_KEYS, STRUCTURAL_BLOCK_TYPES } from './docSchema.js';

/** Guard against a malformed document causing unbounded recursion. */
export const MAX_BLOCK_DEPTH = 32;

export interface TreeBlock {
  id: string;
  type: string;
  /** Null for a top-level block. */
  parentId: string | null;
  /** Depth-first ordinal within the page, starting at 0. */
  position: number;
  /**
   * Nesting depth, derived from the indent attribute and from structural
   * containers. Normalised: a block cannot be more than one level deeper than
   * the block before it, so a document with a jump from 0 to 3 reads as 0 to 1
   * rather than producing an impossible tree.
   */
  depth: number;
  props: Record<string, unknown>;
  /** Inline text, flattened. Empty for atoms and structural containers. */
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

/**
 * Serialise block props.
 *
 * Keys sorted, so the same props always produce the same string. Two writers
 * emitting different byte sequences for identical content means a CRDT update
 * for a change nobody made, and a diff that looks like an edit.
 *
 * This was written inline in three places, one of which sorted and two of which
 * did not. Shared here before a fourth could be added.
 *
 * An empty object serialises to null rather than "{}": absent and empty mean the
 * same thing, and the shorter form keeps the document smaller.
 */
export function serialiseProps(props: Record<string, unknown>): string | null {
  const keys = Object.keys(props).sort();
  if (keys.length === 0) return null;
  const ordered: Record<string, unknown> = {};
  for (const key of keys) ordered[key] = props[key];
  return JSON.stringify(ordered);
}

/**
 * Coerce an XML attribute value.
 *
 * Everything in a Y.XmlElement attribute is a string, but the values came from
 * ProseMirror node attributes, which are numbers, booleans and strings. A
 * heading whose level reads as `"3"` fails every `typeof === 'number'` check
 * downstream, so the coercion has to happen somewhere; here is the one place
 * that knows these values are a serialised form rather than free text.
 *
 * Deliberately narrow: only the four literals JSON has, plus finite numbers.
 * Anything else stays a string, because guessing further would turn a colour
 * called "0x1" or a title called "null" into something else.
 */
function coerceAttribute(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw === '') return '';
  // Only a value that round-trips exactly is treated as a number, so "007" and
  // "1e" stay strings.
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && String(asNumber) === raw) return asNumber;
  return raw;
}

/**
 * Every property of a block, from both places they can live.
 *
 * ProseMirror node attributes are written as XML attributes by y-prosemirror —
 * `level` on a heading, `checked` on a todo, `collapsed` on a toggle, `url` on
 * an image. The `props` attribute is a JSON object for anything ProseMirror does
 * not model.
 *
 * Reading only the JSON, which is what this used to do, meant the projection
 * never saw a heading's level or a todo's checked state. The outline showed
 * every heading at one size and the task panel showed every task as open, and
 * neither looked broken enough to investigate.
 *
 * The explicit `props` object wins on a conflict: it is the richer form, and a
 * value deliberately written there should not be shadowed by a stale attribute.
 */
function readAllProps(
  element: Y.XmlElement,
  warnings: string[],
  id: string,
): Record<string, unknown> {
  const derived: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(element.getAttributes())) {
    if (
      key === BLOCK_ATTRS.id ||
      key === BLOCK_ATTRS.props ||
      key === BLOCK_ATTRS.indent
    ) {
      continue;
    }
    // y-prosemirror stores a ProseMirror attribute with its original type, so
    // `level` arrives as the number 3 and `checked` as a boolean — while an
    // element written by hand, by an importer, or read from serialised XML has
    // strings. Both shapes occur in the same document.
    //
    // A `typeof value !== 'string'` guard here silently skipped every
    // non-string, which is to say every attribute the editor had written. The
    // outline saw no heading levels and the task panel saw no checked state,
    // and nothing looked broken enough to investigate.
    derived[key] = typeof value === 'string' ? coerceAttribute(value) : value;
  }

  return {
    ...derived,
    ...parseProps(element.getAttribute(BLOCK_ATTRS.props), warnings, id),
  };
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
      /*
       * The delta, not `toString()`.
       *
       * `Y.XmlText.toString()` *serialises* — a bold word comes back as
       * `<strong>bold</strong>`. So every mark in the document has been going
       * into the search index as literal tags, which is why searching for
       * "strong" matched half a workspace and why a word at the start of a bold
       * run could not be found at all. Reading a past version showed it plainly
       * for the first time; the projection had been wrong since it was written.
       */
      parts.push(
        child
          .toDelta()
          .map((op: { insert?: unknown }) =>
            typeof op.insert === 'string' ? op.insert : '',
          )
          .join(''),
      );
    } else if (child instanceof Y.XmlElement) {
      // A child carrying a block id is a block, not inline content.
      if (child.getAttribute(BLOCK_ATTRS.id)) continue;
      /*
       * A mention contributes the name it draws (ADR-0085).
       *
       * It is an atom with no text children, so descending into it finds
       * nothing — and a sentence that reads "@Anna, can you look at this?" would
       * be indexed and excerpted as ", can you look at this?". Searching for a
       * colleague's name would find every page except the ones that name them.
       */
      const mentioned = child.nodeName === MENTION_NODE ? mentionLabel(child) : null;
      if (mentioned !== null) {
        parts.push(`@${mentioned}`);
        continue;
      }
      parts.push(inlineText(child, depth + 1));
    }
  }
  return parts.join('');
}

/**
 * Read the indent attribute, tolerating anything malformed.
 *
 * A missing or unparseable value reads as 0 rather than throwing: an indent is
 * presentation structure, and losing it degrades a document rather than
 * breaking it.
 */
function readIndent(element: Y.XmlElement): number {
  const raw = element.getAttribute(BLOCK_ATTRS.indent);
  if (raw === undefined || raw === null || raw === '') return 0;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  // Cap defensively: an absurd indent from a buggy client should not produce a
  // pathological tree.
  return Math.min(parsed, MAX_BLOCK_DEPTH);
}

/**
 * Walk a page's block tree in reading order.
 *
 * Two mechanisms produce parent-child relationships and they compose:
 *
 *   indent      Text blocks are XML siblings; a block with a greater indent
 *               than the one before it is its child. This is the common case,
 *               and it exists because ProseMirror forbids a node holding both
 *               inline text and block children (ADR-0018).
 *   structure   A textless container (a column) holds its children as XML
 *               children, and indentation restarts inside it.
 *
 * Depth-first order is the reading order, which is what every consumer wants:
 * the materialiser assigns positions from it, and the search index concatenates
 * in it.
 */
export function readBlockTree(doc: Y.Doc): TreeReadResult {
  const warnings: string[] = [];
  const blocks: TreeBlock[] = [];
  const byId = new Map<string, TreeBlock>();
  let position = 0;

  const visit = (
    container: Y.XmlFragment | Y.XmlElement,
    structuralParentId: string | null,
    baseDepth: number,
  ): void => {
    if (baseDepth > MAX_BLOCK_DEPTH) {
      warnings.push(`block tree exceeds depth ${MAX_BLOCK_DEPTH}; subtree ignored`);
      return;
    }

    // Ancestors implied by indentation, innermost last.
    const stack: Array<{ id: string; indent: number }> = [];

    for (let i = 0; i < container.length; i++) {
      const child: unknown = container.get(i);

      if (child instanceof Y.XmlText) {
        // Its own text, not the container's: this branch is about *this* stray
        // node. My first edit reached for the enclosing element, which would
        // have reported loose text whenever the block had any at all.
        if (child.toString().trim() !== '') {
          // Text with no owning block cannot be materialised or edited
          // coherently. Reported so it is visible rather than silently dropped.
          warnings.push('loose text outside any block; not materialised');
        }
        continue;
      }
      if (!(child instanceof Y.XmlElement)) continue;

      const id = child.getAttribute(BLOCK_ATTRS.id);
      if (!id) {
        // Inline content that reached block level, or a node type the editor
        // schema allows but SONE does not model. Skipped, not fatal.
        warnings.push(`element <${child.nodeName}> has no block id; skipped`);
        continue;
      }

      const type = child.nodeName;
      const rawIndent = readIndent(child);

      // Normalise: a block may be at most one level deeper than its
      // predecessor. Without this, an indent jump produces a parent that does
      // not exist.
      const previousIndent = stack.length > 0 ? stack[stack.length - 1]!.indent : -1;
      const indent = Math.min(rawIndent, previousIndent + 1);
      if (indent !== rawIndent) {
        warnings.push(
          `block ${id}: indent ${rawIndent} exceeds one level below its predecessor; read as ${indent}`,
        );
      }

      while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
        stack.pop();
      }

      const parentId = stack.length > 0 ? stack[stack.length - 1]!.id : structuralParentId;

      const block: TreeBlock = {
        id,
        type,
        parentId,
        position: position++,
        depth: baseDepth + stack.length,
        props: readAllProps(child, warnings, id),
        text: inlineText(child),
        childIds: [],
      };
      blocks.push(block);
      byId.set(id, block);

      if (parentId !== null) {
        byId.get(parentId)?.childIds.push(id);
      }

      stack.push({ id, indent });

      // A structural container holds its children as XML children, and
      // indentation starts over inside it.
      if (STRUCTURAL_BLOCK_TYPES.has(type) || hasBlockChildren(child)) {
        visit(child, id, block.depth + 1);
      }
    }
  };

  visit(pageContent(doc), null, 0);

  return { blocks, warnings };
}

/**
 * Does this element hold block children?
 *
 * Checked in addition to the structural-type set so a third-party block type
 * that nests still materialises correctly without registering itself first.
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
  /** Indentation level. Children are expressed this way for text blocks. */
  indent?: number;
  /** XML children. Only valid for structural (textless) container types. */
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
    element.setAttribute(BLOCK_ATTRS.props, serialiseProps(block.props) ?? '');
  }

  // Omitted when zero, keeping documents smaller and diffs readable.
  if (block.indent !== undefined && block.indent > 0) {
    element.setAttribute(BLOCK_ATTRS.indent, String(block.indent));
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
      element.setAttribute(BLOCK_ATTRS.props, serialiseProps(next) ?? '');
    }
  });
  return true;
}

/**
 * Change one block's props in a document.
 *
 * Exists so a surface that is not the editor — a task list, an outline, a
 * future API — can toggle a checkbox or set a property without a ProseMirror
 * view. Everything else about a block goes through the editor; props are the
 * part that is meaningful on its own.
 *
 * Found by id rather than by position, because the caller holds an id and
 * nothing else: a task list built a moment ago may describe a document that has
 * since changed. Returns false when the block is gone, which is a normal
 * outcome rather than an error.
 *
 * Props are merged, not replaced. A caller that knows about `checked` should not
 * have to know what else a block carries, and replacing would silently drop
 * properties written by a newer version of SONE (ADR-0013).
 */
export function setBlockProps(
  doc: Y.Doc,
  blockId: string,
  patch: Record<string, unknown>,
): boolean {
  // findBlockElement already walks the fragment by id, including nested blocks.
  // A second search here would be a second definition of "where is this block",
  // and two of those drift.
  const element = findBlockElement(doc, blockId);
  if (!element) return false;

  // Written as XML attributes, not into the props JSON.
  //
  // ProseMirror node attributes are the canonical storage — they are what
  // y-prosemirror writes and what the editor reads back. Writing `checked` into
  // the props JSON instead produced a value the projection could see and the
  // editor could not, so ticking a box in the task panel changed nothing on the
  // page. The `props` JSON stays readable for anything ProseMirror does not
  // model, but these helpers no longer write it.
  //
  // A shadow copy in the props JSON is cleared for any key being set here, or
  // the JSON — which wins on read — would keep overriding the attribute.
  const existingJson = parseProps(element.getAttribute(BLOCK_ATTRS.props), [], blockId);
  const shadowed = Object.keys(patch).filter((key) => key in existingJson);

  doc.transact(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        element.removeAttribute(key);
      } else {
        // Stored with its own type, which is what ProseMirror expects to read
        // back and what y-prosemirror writes.
        element.setAttribute(key, value as never);
      }
    }

    if (shadowed.length > 0) {
      const remaining = { ...existingJson };
      for (const key of shadowed) delete remaining[key];
      const serialised = serialiseProps(remaining);
      if (serialised === null) element.removeAttribute(BLOCK_ATTRS.props);
      else element.setAttribute(BLOCK_ATTRS.props, serialised);
    }
  });
  return true;
}

/** The element name a mention is stored under. One place, three readers. */
export const MENTION_NODE = 'mention';
/** Attribute names on a mention element. */
export const MENTION_ATTRS = { userId: 'userId', label: 'label' } as const;

/** The name a mention draws, or null when it carries none. */
function mentionLabel(element: Y.XmlElement): string | null {
  const label = element.getAttribute(MENTION_ATTRS.label);
  return typeof label === 'string' ? label : '';
}

/**
 * Everybody named in a document's blocks, with the block they were named in
 * (ADR-0085).
 *
 * The block matters: a notification says where to look, and "somewhere on this
 * page" is not where to look. It is also what makes the notification stable —
 * one per person per block, so editing the sentence around a name does not
 * announce it again.
 *
 * Read from the document rather than trusted from a client, for the same reason
 * comment notifications are (ADR-0052): a notification a client creates is a
 * notification a client can forge.
 *
 * **`writtenBy` is who put the name there**, from the CRDT's own record of which
 * client inserted the node, resolved through the document's attribution mapping
 * (ADR-0022). Null when the document does not say — an old page, or attribution
 * pruned away after the writer's other words were deleted.
 *
 * It is here because the alternative was worse and shipped. A mention is not
 * announced to the person who wrote it, and with nothing in the document saying
 * who that was, the projection substituted its own actor — which is "whoever
 * last sent a sync message", not "who typed this". So the person most likely to
 * have the page open when somebody named them was the person whose mention got
 * dropped as a note to self (ADR-0091).
 *
 * A comment message has carried its author as a field since ADR-0046 for
 * exactly this reason. Page text has no field to carry one, so it is read from
 * the item — which is the same answer arrived at from the other end.
 */
export function mentionsIn(
  doc: Y.Doc,
): Array<{ userId: string; blockId: string; writtenBy: string | null }> {
  const out: Array<{ userId: string; blockId: string; writtenBy: string | null }> = [];
  const seen = new Set<string>();

  const { blocks } = readBlockTree(doc);
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const authors = authorsByClient(doc);

  const walk = (element: Y.XmlElement, blockId: string | null, depth: number): void => {
    if (depth > MAX_BLOCK_DEPTH) return;
    for (let i = 0; i < element.length; i++) {
      const child: unknown = element.get(i);
      if (!(child instanceof Y.XmlElement)) continue;

      const ownId = child.getAttribute(BLOCK_ATTRS.id);
      const within = typeof ownId === 'string' && ownId !== '' ? ownId : blockId;

      if (child.nodeName === MENTION_NODE) {
        const userId = child.getAttribute(MENTION_ATTRS.userId);
        // A mention with no id names nobody: it is decoration, or a document
        // written by something that did not finish. Never a notification.
        if (typeof userId === 'string' && userId !== '' && within && byId.has(within)) {
          const key = `${userId}\u0000${within}`;
          if (!seen.has(key)) {
            seen.add(key);
            // The item that holds this node is the insertion that made it, so
            // its client is the person who typed the name.
            const client = child._item?.id.client;
            out.push({
              userId,
              blockId: within,
              writtenBy: client === undefined ? null : (authors.get(client) ?? null),
            });
          }
        }
        continue;
      }
      walk(child, within, depth + 1);
    }
  };

  // Through the same accessor the rest of this file uses, so a document
  // opened two ways is one document.
  walk(pageContent(doc) as unknown as Y.XmlElement, null, 0);
  return out;
}

/**
 * Marks a fragment as naming a block rather than a heading anchor.
 *
 * The same two characters `paths.ts` writes on the web side. Here rather than
 * imported because that module is the application's and this package sits
 * underneath it — a constant shared across that boundary has to live on this
 * side of it.
 */
export const BLOCK_FRAGMENT = 'b-';

/**
 * The uuid a page address names, and the block it points at (ADR-0174).
 *
 * ## Why a uuid in the path is enough, without knowing the host
 *
 * A stored internal link comes in three shapes: `/p/<uuid>` written by the `[[`
 * picker (ADR-0173), `<origin>/p/<uuid>` pasted from the handle menu's
 * clipboard (ADR-0170), and `/s/<token>/p/<uuid>` from a document old enough to
 * have been written before that was stopped. All three carry the same uuid in
 * the same position, so this reads the path and ignores the rest of the
 * address.
 *
 * That means an *external* `https://example.org/p/<uuid>` matches too — and it
 * is harmless, because **the existence check is the origin check**. A row is
 * only written for a uuid that names a page in this instance, and a uuid that
 * names a page here is a page here. A foreign address would have to collide
 * with one of this instance's own uuids to produce anything, which is not a
 * thing that happens by accident — and it needs no configured hostname, which
 * is a setting that can be wrong the day somebody moves the instance.
 */
const PAGE_HREF =
  /(?:^|\/)p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=$|[/?#])/i;

function pageFromHref(href: string): { pageId: string; toBlockId: string | null } | null {
  // The fragment is split off first: it is not part of the path, and leaving it
  // on would let `#b-…` be read as a further segment.
  const hash = href.indexOf('#');
  const fragment = hash === -1 ? '' : href.slice(hash + 1);
  const path = hash === -1 ? href : href.slice(0, hash);

  const found = PAGE_HREF.exec(path.split('?')[0] ?? '');
  if (!found) return null;

  const block = fragment.startsWith(BLOCK_FRAGMENT)
    ? fragment.slice(BLOCK_FRAGMENT.length)
    : '';
  return { pageId: found[1]!.toLowerCase(), toBlockId: block === '' ? null : block };
}

/**
 * Every page this document links to, with the block the link sits in.
 *
 * The reading half of *„wer zeigt hierher"*. The panel that answers *what does
 * this page link to* reads the document in the browser, which is enough because
 * that document is open; the pages that point **here** are documents nobody has
 * open, so the answer has to be projected — and projected from the document
 * rather than reported by a client, for the reason mentions are (ADR-0085): a
 * link a client reports is a link a client can forge.
 *
 * **One row per page per block.** Somebody who names a page twice in a sentence
 * has referred to it once as far as this question goes, and the block is what
 * makes the row stable — editing the words around a link does not make it a
 * different link.
 *
 * A link whose target does not exist in this instance is still returned here.
 * Whether it becomes a row is the projection's decision, and the projection has
 * the table of pages to ask.
 */
export function linksIn(
  doc: Y.Doc,
): Array<{ pageId: string; blockId: string; toBlockId: string | null }> {
  const out: Array<{ pageId: string; blockId: string; toBlockId: string | null }> = [];
  const seen = new Set<string>();

  const { blocks } = readBlockTree(doc);
  const byId = new Map(blocks.map((block) => [block.id, block]));

  const walk = (element: Y.XmlElement, blockId: string | null, depth: number): void => {
    if (depth > MAX_BLOCK_DEPTH) return;
    for (let i = 0; i < element.length; i++) {
      const child: unknown = element.get(i);

      if (child instanceof Y.XmlText) {
        if (!blockId || !byId.has(blockId)) continue;
        /*
         * The delta, because that is where a mark lives. `toString()`
         * serialises to tags — the mistake `inlineText` above records — and an
         * href would then have to be parsed back out of an `<a>` in a string.
         */
        for (const op of child.toDelta() as Array<{ attributes?: Record<string, unknown> }>) {
          const mark = op.attributes?.['link'];
          if (!mark || typeof mark !== 'object') continue;
          const href = (mark as Record<string, unknown>)['href'];
          if (typeof href !== 'string') continue;

          const target = pageFromHref(href);
          if (!target) continue;

          const key = `${target.pageId} ${blockId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ pageId: target.pageId, blockId, toBlockId: target.toBlockId });
        }
        continue;
      }

      if (!(child instanceof Y.XmlElement)) continue;
      const ownId = child.getAttribute(BLOCK_ATTRS.id);
      const within = typeof ownId === 'string' && ownId !== '' ? ownId : blockId;
      walk(child, within, depth + 1);
    }
  };

  // Through the same accessor the rest of this file uses, so a document opened
  // two ways is one document.
  walk(pageContent(doc) as unknown as Y.XmlElement, null, 0);
  return out;
}
