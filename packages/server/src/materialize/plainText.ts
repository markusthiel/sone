/**
 * SONE — plain-text projection of block content.
 *
 * Feeds the search index. Deliberately lossy: formatting, colours and marks
 * are dropped. The output is never read back into a CRDT (ADR-0002), so
 * losing information here is safe by construction.
 *
 * Inline text extraction itself lives in @sone/core's blockTree, next to the
 * tree walk it belongs to. What remains here is normalisation and the
 * per-block-type props projection, both of which are materialiser concerns.
 */

/** Guard against a pathological block consuming the whole index. */
const MAX_BLOCK_TEXT = 64 * 1024;

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
