/**
 * SONE — plain-text projection of block content.
 *
 * Feeds the search index. Deliberately lossy: formatting, colours and marks
 * are dropped. The output is never read back into a CRDT (ADR-0002), so
 * losing information here is safe by construction.
 */

import * as Y from 'yjs';

/** Guard against a pathological block consuming the whole index. */
const MAX_BLOCK_TEXT = 64 * 1024;

/**
 * Extract text from a Y.XmlFragment, the shape ProseMirror stores.
 *
 * Walks recursively because inline content nests: a paragraph containing a
 * link containing text. Depth-limited so a malformed document cannot cause
 * unbounded recursion on the write path.
 */
export function xmlFragmentToText(
  node: Y.XmlFragment | Y.XmlElement | Y.XmlText | Y.XmlHook,
  depth = 0,
): string {
  if (depth > 32) return '';

  if (node instanceof Y.XmlText) return node.toString();
  if (node instanceof Y.XmlHook) return '';

  const parts: string[] = [];
  for (let i = 0; i < node.length; i++) {
    // Widened deliberately: Y.XmlFragment.get() is typed narrowly, but a
    // document written by another client may hold any Xml node here.
    const child: unknown = node.get(i);
    if (
      child instanceof Y.XmlElement ||
      child instanceof Y.XmlText ||
      child instanceof Y.XmlFragment ||
      child instanceof Y.XmlHook
    ) {
      parts.push(xmlFragmentToText(child, depth + 1));
    }
  }
  return parts.join(' ');
}

/**
 * Normalise extracted text: collapse whitespace, strip control characters,
 * truncate.
 *
 * Control characters matter — a NUL byte in a text column is a Postgres error,
 * and pasted content can contain them.
 */
export function normaliseText(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BLOCK_TEXT);
}

/**
 * Text from block props for block types whose content is not inline text.
 *
 * A code block's source, an image's alt text, an embed's URL: all searchable,
 * none of it in a Y.XmlFragment. Types not listed contribute nothing, which
 * is the correct default for a new block type until it opts in.
 */
export function propsToText(type: string, props: Record<string, unknown>): string {
  const pick = (...keys: string[]): string =>
    keys
      .map((k) => props[k])
      .filter((v): v is string => typeof v === 'string')
      .join(' ');

  switch (type) {
    case 'code':
      return pick('source', 'language');
    case 'image':
    case 'file':
      return pick('alt', 'caption', 'filename');
    case 'embed':
      return pick('url', 'caption');
    case 'callout':
      return pick('emoji');
    default:
      return '';
  }
}
