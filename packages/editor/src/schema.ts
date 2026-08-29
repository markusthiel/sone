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

import {
  BLOCK_ALIGNMENTS,
  BLOCK_ATTRS,
  BLOCK_COLORS,
  BLOCK_WIDTHS,
  serialiseProps,
} from '@sone/core';
import { Schema, type MarkSpec, type Node as PMNode, type NodeSpec } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

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

  // Only values the schema knows.
  //
  // These come from a document another client wrote, so an unknown one is
  // dropped rather than emitted: `data-color="'; }"` in a stylesheet selector
  // is not an attack this can suffer, but a value nothing styles is a setting
  // that appears to have been accepted and does nothing.
  const align = node.attrs[BLOCK_ATTRS.align];
  if (typeof align === 'string' && (BLOCK_ALIGNMENTS as readonly string[]).includes(align)) {
    attrs['data-align'] = align;
  }
  const width = node.attrs[BLOCK_ATTRS.width];
  if (typeof width === 'string' && (BLOCK_WIDTHS as readonly string[]).includes(width)) {
    attrs['data-width'] = width;
  }
  const color = node.attrs[BLOCK_ATTRS.color];
  if (typeof color === 'string' && (BLOCK_COLORS as readonly string[]).includes(color)) {
    attrs['data-color'] = color;
  }

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
  /**
   * Presentation, shared by every block type.
   *
   * Null means "as the design decides", which is what almost every block should
   * carry — an explicit value is somebody overriding, and overrides that are
   * indistinguishable from defaults cannot be reset.
   */
  [BLOCK_ATTRS.align]: { default: null as string | null },
  [BLOCK_ATTRS.width]: { default: null as string | null },
  [BLOCK_ATTRS.color]: { default: null as string | null },
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
/**
 * Serialise block props.
 *
 * Delegates to @sone/core. Two implementations of the same serialisation is how
 * two writers end up producing different strings for identical props, which
 * records a CRDT change where none happened — the reason the sorting exists at
 * all. Kept as a re-export so callers in this package do not have to know.
 */
export const writeProps = serialiseProps;

/**
 * Add SONE's block attributes to generated node specs.
 *
 * `tableNodes()` does not take extra attributes for the table and row nodes, so
 * they are added here. Every block needs `id`, `props` and `indent` or the tree
 * reader will not see it (ADR-0015, ADR-0018), and the DOM attributes are needed
 * so styling and drag targets can find a block.
 */
function withBlockAttrs(specs: Record<string, NodeSpec>): Record<string, NodeSpec> {
  const out: Record<string, NodeSpec> = {};

  for (const [name, spec] of Object.entries(specs)) {
    const originalToDOM = spec.toDOM;
    out[name] = {
      ...spec,
      attrs: { ...blockAttrs, ...(spec.attrs ?? {}) },
      toDOM: originalToDOM
        ? (node) => {
            const rendered = originalToDOM(node) as [string, ...unknown[]];
            const [tag, maybeAttrs, ...rest] = rendered;
            // The generated spec may or may not emit an attribute object, so
            // both shapes are handled rather than assumed.
            // ProseMirror's toDOM output is [tag, attrs?, ...children], where
            // a child may be the number 0 (the content hole) or a nested array.
            // Only a plain object in that slot is an attribute map. The `typeof`
            // check already excludes 0, so no separate test for it.
            const isAttrs =
              maybeAttrs !== null &&
              typeof maybeAttrs === 'object' &&
              !Array.isArray(maybeAttrs);
            return isAttrs
              ? [tag, { ...blockDOMAttrs(node), ...(maybeAttrs as object) }, ...rest]
              : [tag, blockDOMAttrs(node), ...(maybeAttrs === undefined ? [] : [maybeAttrs]), ...rest];
          }
        : undefined,
    } as NodeSpec;
  }

  return out;
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
    toDOM: (node) => {
      const props = readProps(node.attrs);
      const url = node.attrs['url'];
      const attrs = blockDOMAttrs(node);

      // An image block without a URL is not an error: an upload may be in
      // flight, or may have failed. Both states are rendered, because a block
      // that renders as nothing looks like content that was lost.
      if (typeof url !== 'string' || url === '') {
        const failed = props['failed'] === true;
        attrs['data-state'] = failed ? 'failed' : 'uploading';
        const label = failed
          ? `Could not upload ${String(props['filename'] ?? 'image')}${
              props['error'] ? `: ${String(props['error'])}` : ''
            }`
          : `Uploading ${String(props['filename'] ?? 'image')}…`;
        return ['div', attrs, ['span', label]];
      }

      return [
        'div',
        attrs,
        ['img', { src: url, alt: (node.attrs['alt'] as string) ?? '' }],
      ];
    },
  },

  /**
   * An attached file.
   *
   * Separate from `image` rather than a variant of it, because the two answer
   * different questions. An image *is* the content — it is looked at. A file is
   * referred to: it has a name, a size and a type worth showing, and often the
   * point is that somebody can open it rather than read it here.
   *
   * `display` is the file's own, not the shared `width` attribute. Width says
   * how much room a block takes; display says which of three quite different
   * things to draw — a card, one line, or a viewer. A wide card and a full
   * viewer are not points on the same scale.
   */
  file: {
    group: 'block',
    attrs: {
      ...blockAttrs,
      fileId: { default: null },
      filename: { default: '' },
      mimeType: { default: '' },
      /** 'image' | 'pdf' | 'text' | 'document' | 'archive', from the server. */
      category: { default: 'document' },
      sizeBytes: { default: null },
      /** 'card' | 'line' | 'full'. */
      display: { default: 'card' },
    },
    atom: true,
    draggable: true,
    parseDOM: [
      {
        tag: 'div[data-sone-file]',
        getAttrs: (dom) => {
          const element = dom as HTMLElement;
          return {
            fileId: element.getAttribute('data-sone-file'),
            filename: element.getAttribute('data-filename') ?? '',
            mimeType: element.getAttribute('data-mime') ?? '',
            category: element.getAttribute('data-category') ?? 'document',
            display: element.getAttribute('data-display') ?? 'card',
          };
        },
      },
    ],
    toDOM: (node) => {
      const attrs = blockDOMAttrs(node);
      const fileId = node.attrs['fileId'];

      // Rendered even without an id, for the same reason an image is: an upload
      // in flight or one that failed must not look like content that vanished.
      if (typeof fileId === 'string' && fileId !== '') {
        attrs['data-sone-file'] = fileId;
      }
      attrs['data-filename'] = String(node.attrs['filename'] ?? '');
      attrs['data-mime'] = String(node.attrs['mimeType'] ?? '');
      attrs['data-category'] = String(node.attrs['category'] ?? 'document');
      attrs['data-display'] = String(node.attrs['display'] ?? 'card');

      return ['div', attrs, ['span', String(node.attrs['filename'] ?? 'File')]];
    },
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

  /**
   * Tables, from prosemirror-tables.
   *
   * Used rather than hand-rolled. Cell selection across a rectangle, splitting
   * and merging cells, column resizing and repairing a malformed table are all
   * genuinely hard, and that package is maintained by ProseMirror's author. It
   * is MIT and pinned exactly, like everything else (ADR-0017).
   *
   * The generated specs are extended with SONE's block attributes rather than
   * used as they come. Without an `id` the tree reader skips an element and
   * everything inside it — so a table would be invisible to the projection and
   * to search, which is precisely where a table's contents most need to be
   * findable.
   *
   * Rows and cells are textless containers holding blocks, which is the shape
   * ADR-0018 permits: a node either has text or holds blocks, never both.
   */
  ...withBlockAttrs(
    tableNodes({
      tableGroup: 'block',
      // Blocks, not inline: a cell holding a list or a heading is normal in a
      // notes app, and restricting cells to text would be a limit people hit
      // immediately.
      cellContent: 'block+',
      cellAttributes: {},
    }),
  ),

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
