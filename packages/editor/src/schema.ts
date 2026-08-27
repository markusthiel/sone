/**
 * SONE — the ProseMirror schema.
 *
 * Every block type is a ProseMirror node, and every node carries the two
 * attributes the persisted format defines (ADR-0015): `id` and `props`.
 * y-prosemirror maps node attributes onto Y.XmlElement attributes one to one,
 * which is why `props` is a JSON string rather than a structured attribute —
 * a Yjs XML attribute is a string, and the block tree reader in `@sone/core`
 * expects exactly this encoding.
 *
 * The consequence worth stating: this schema and `readBlockTree` are two halves
 * of one contract. If they disagree, the editor shows something the server never
 * materialises, or the reverse. The round-trip test exists for that reason and
 * is not optional.
 *
 * Inline formatting is marks, not blocks: bold text is not a block type, and
 * modelling it as one would make every style change a tree operation.
 */

import { BLOCK_ATTRS } from '@sone/core';
import { Schema, type MarkSpec, type Node as PMNode, type NodeSpec } from 'prosemirror-model';

/**
 * DOM attributes every block carries.
 *
 * `data-block-id` so a drag handle, a node view or a link target can find a
 * block in the DOM without walking ProseMirror positions. `data-indent` because
 * indentation is an attribute now (ADR-0018) and CSS is what turns it into
 * visible nesting — computing pixel margins in JavaScript would fight the
 * browser on every reflow.
 */
function blockDOMAttrs(node: PMNode): Record<string, string> {
  const attrs: Record<string, string> = { 'data-block': node.type.name };
  const id = node.attrs[BLOCK_ATTRS.id];
  if (typeof id === 'string' && id !== '') attrs['data-block-id'] = id;
  const indent = readIndent(node.attrs);
  if (indent > 0) attrs['data-indent'] = String(indent);
  return attrs;
}

/**
 * Attributes shared by every block node.
 *
 * `id` defaults to null and is filled in by the blockIds plugin rather than
 * here: a schema default cannot be unique, and two blocks sharing an id is the
 * one thing the projection cannot tolerate (blocks.id is a primary key).
 */
const blockAttrs = {
  [BLOCK_ATTRS.id]: { default: null as string | null },
  [BLOCK_ATTRS.props]: { default: null as string | null },
  /**
   * Indentation level, stored as a string because Yjs XML attributes are
   * strings and y-prosemirror maps attributes one to one.
   *
   * This is how a list item gets sub-items. ProseMirror forbids a node
   * containing both inline text and block children, so a textual block cannot
   * be a real container — the constraint is absolute (ADR-0018).
   */
  [BLOCK_ATTRS.indent]: { default: null as string | null },
};

/** Read a block's props, tolerating anything malformed. */
export function readProps(attrs: Record<string, unknown>): Record<string, unknown> {
  const raw = attrs[BLOCK_ATTRS.props];
  if (typeof raw !== 'string' || raw === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Encode props for storage, omitting the attribute entirely when empty. */
export function writeProps(props: Record<string, unknown>): string | null {
  const keys = Object.keys(props);
  if (keys.length === 0) return null;
  // Keys are sorted so the same props always serialise identically. Without
  // this, two clients writing equivalent props produce different strings and
  // the CRDT records a change where none happened.
  const ordered: Record<string, unknown> = {};
  for (const key of keys.sort()) ordered[key] = props[key];
  return JSON.stringify(ordered);
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: blockAttrs,
    parseDOM: [{ tag: 'p' }],
    toDOM: (node) => ['p', blockDOMAttrs(node), 0],
  },

  heading: {
    group: 'block',
    content: 'inline*',
    attrs: { ...blockAttrs, level: { default: 2 } },
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    })),
    toDOM: (node) => [
      `h${node.attrs['level'] as number}`,
      blockDOMAttrs(node),
      0,
    ],
  },

  // Lists are flat textblocks carrying an indent, not nested containers.
  //
  // The original design had them hold text plus nested blocks, which
  // ProseMirror rejects outright: a node may contain inline content or block
  // content, never both. Indentation as an attribute is what Notion and Craft
  // do, and it makes indent/outdent an attribute change rather than a tree
  // operation (ADR-0018).
  bulletList: {
    group: 'block',
    content: 'inline*',
    attrs: blockAttrs,
    // A div rather than li: these are flat siblings with an indent, not
    // children of a ul, and nesting li outside a list is invalid markup that
    // browsers render inconsistently. CSS draws the marker.
    parseDOM: [{ tag: 'div[data-block=bulletList]' }, { tag: 'li' }],
    toDOM: (node) => ['div', blockDOMAttrs(node), 0],
  },

  numberedList: {
    group: 'block',
    content: 'inline*',
    attrs: blockAttrs,
    parseDOM: [{ tag: 'div[data-block=numberedList]' }, { tag: 'li' }],
    toDOM: (node) => ['div', blockDOMAttrs(node), 0],
  },

  todo: {
    group: 'block',
    content: 'inline*',
    attrs: { ...blockAttrs, checked: { default: false } },
    parseDOM: [
      {
        tag: 'li[data-type=todo]',
        getAttrs: (dom) => ({
          checked: (dom as HTMLElement).getAttribute('data-checked') === 'true',
        }),
      },
    ],
    toDOM: (node) => [
      'div',
      {
        ...blockDOMAttrs(node),
        'data-checked': String(node.attrs['checked'] === true),
      },
      0,
    ],
  },

  toggle: {
    group: 'block',
    content: 'inline*',
    attrs: { ...blockAttrs, collapsed: { default: false } },
    parseDOM: [{ tag: 'details' }],
    toDOM: (node) => [
      'div',
      {
        ...blockDOMAttrs(node),
        'data-collapsed': String(node.attrs['collapsed'] === true),
      },
      0,
    ],
  },

  quote: {
    group: 'block',
    content: 'inline*',
    attrs: blockAttrs,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: (node) => ['blockquote', blockDOMAttrs(node), 0],
  },

  callout: {
    group: 'block',
    content: 'inline*',
    attrs: blockAttrs,
    parseDOM: [{ tag: 'aside' }],
    toDOM: (node) => ['aside', blockDOMAttrs(node), 0],
  },

  code: {
    group: 'block',
    content: 'text*',
    attrs: { ...blockAttrs, language: { default: null } },
    // `code: true` stops input rules and marks applying inside; `marks: ''`
    // stops formatting being stored. Without both, typing `# ` inside a code
    // block would turn it into a heading.
    code: true,
    marks: '',
    defining: true,
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM: (node) => ['pre', blockDOMAttrs(node), ['code', 0]],
  },

  divider: {
    group: 'block',
    attrs: blockAttrs,
    parseDOM: [{ tag: 'hr' }],
    // Wrapped so the indent attribute has somewhere to live: an hr cannot
    // carry children and CSS cannot indent a replaced element consistently.
    toDOM: (node) => ['div', blockDOMAttrs(node), ['hr']],
  },

  image: {
    group: 'block',
    attrs: { ...blockAttrs, url: { default: null }, alt: { default: '' } },
    // An atom: selectable and deletable as a unit, with no editable content.
    atom: true,
    draggable: true,
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (dom) => ({
          url: (dom as HTMLElement).getAttribute('src'),
          alt: (dom as HTMLElement).getAttribute('alt') ?? '',
        }),
      },
    ],
    toDOM: (node) => [
      'div',
      blockDOMAttrs(node),
      ['img', { src: node.attrs['url'] as string, alt: node.attrs['alt'] as string }],
    ],
  },

  /**
   * An embedded database view.
   *
   * An atom to ProseMirror, with its own renderer mounted by a node view
   * (ADR-0004, ADR-0015). Rows are emphatically not editor nodes: a few
   * thousand of them would collapse the document.
   */
  collectionView: {
    group: 'block',
    attrs: {
      ...blockAttrs,
      collectionId: { default: null },
      viewId: { default: null },
      display: { default: 'inline' },
    },
    atom: true,
    isolating: true,
    parseDOM: [{ tag: 'div[data-sone-collection]' }],
    toDOM: (node) => [
      'div',
      {
        ...blockDOMAttrs(node),
        'data-sone-collection': node.attrs['collectionId'] as string,
        'data-sone-view': node.attrs['viewId'] as string,
      },
    ],
  },

  /**
   * Columns: a genuinely structural container.
   *
   * Allowed to hold block children because it has no text of its own, which is
   * exactly the condition ProseMirror's mixing rule cares about. Blocks that
   * have both text and children use `indent` instead.
   */
  columns: {
    group: 'block',
    content: 'column+',
    attrs: blockAttrs,
    isolating: true,
    parseDOM: [{ tag: 'div[data-type=columns]' }],
    toDOM: () => ['div', { 'data-type': 'columns' }, 0],
  },

  column: {
    content: 'block+',
    attrs: blockAttrs,
    isolating: true,
    parseDOM: [{ tag: 'div[data-type=column]' }],
    toDOM: () => ['div', { 'data-type': 'column' }, 0],
  },

  text: { group: 'inline' },
};

const marks: Record<string, MarkSpec> = {
  strong: {
    parseDOM: [
      { tag: 'strong' },
      // <b> with a non-bold font-weight is how Google Docs marks up plain
      // text; treating it as bold would make every paste bold.
      {
        tag: 'b',
        getAttrs: (dom) =>
          (dom as HTMLElement).style.fontWeight === 'normal' ? false : null,
      },
      { style: 'font-weight=400', clearMark: (m) => m.type.name === 'strong' },
      {
        style: 'font-weight',
        getAttrs: (value) =>
          /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) ? null : false,
      },
    ],
    toDOM: () => ['strong', 0],
  },

  em: {
    parseDOM: [
      { tag: 'i' },
      { tag: 'em' },
      { style: 'font-style=normal', clearMark: (m) => m.type.name === 'em' },
      { style: 'font-style=italic' },
    ],
    toDOM: () => ['em', 0],
  },

  strikethrough: {
    parseDOM: [
      { tag: 's' },
      { tag: 'del' },
      { style: 'text-decoration=line-through' },
    ],
    toDOM: () => ['s', 0],
  },

  inlineCode: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
    // Excludes everything: bold inside inline code is meaningless and would
    // round-trip badly.
    excludes: '_',
    code: true,
  },

  link: {
    attrs: { href: {}, title: { default: null } },
    // Not inclusive: typing after a link should not extend it, which is what
    // people expect and what the default would get wrong.
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (dom) => ({
          href: (dom as HTMLElement).getAttribute('href'),
          title: (dom as HTMLElement).getAttribute('title'),
        }),
      },
    ],
    toDOM: (mark) => [
      'a',
      {
        href: mark.attrs['href'] as string,
        title: mark.attrs['title'] as string | null,
        // Anything a user pastes is untrusted; without these a link in a shared
        // page can reach back into the opening window.
        rel: 'noopener noreferrer',
      },
      0,
    ],
  },
};

export const schema = new Schema({ nodes, marks });

/** Block node type names, in the order a slash menu should offer them. */
export const BLOCK_TYPE_ORDER = [
  'paragraph',
  'heading',
  'bulletList',
  'numberedList',
  'todo',
  'toggle',
  'quote',
  'callout',
  'code',
  'divider',
] as const;

/**
 * Textual block types that may carry an indent and act as a logical parent.
 *
 * Not the same as ProseMirror containment: none of these hold block children.
 * The name matters because conflating the two is what produced a schema
 * ProseMirror refused to build.
 */
export const INDENTABLE_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'numberedList',
  'todo',
  'toggle',
  'quote',
  'callout',
  'code',
]);

/** Types that hold block children structurally. Textless by necessity. */
export const STRUCTURAL_NODE_TYPES = new Set(['columns', 'column']);

/** Read a block's indent level from its attributes. */
export function readIndent(attrs: Record<string, unknown>): number {
  const raw = attrs[BLOCK_ATTRS.indent];
  if (raw === null || raw === undefined || raw === '') return 0;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** Encode an indent level, omitting it when zero. */
export const writeIndent = (indent: number): string | null =>
  indent > 0 ? String(indent) : null;
