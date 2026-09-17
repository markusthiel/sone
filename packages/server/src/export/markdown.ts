/**
 * SONE server — a page as Markdown (ADR-0044).
 *
 * The ownership argument in one file: a self-hosted tool that cannot hand its
 * contents back in an open format is asking for the trust the hosted ones ask
 * for.
 *
 * Written from the projected block tree rather than from the Yjs document,
 * because the projection is already the flat, ordered, plain-text shape this
 * needs — and because the materialiser is the one thing that has to understand
 * every block type anyway.
 *
 * What is *not* Markdown gets a fenced block carrying its own data. A collection,
 * a canvas or a video has no Markdown spelling, and the two honest options are to
 * lose it or to write it down in a form our own importer can read back while
 * another tool sees a code block. Losing it is how an export becomes a thing
 * nobody trusts.
 */

import {
  CALLOUT_TONE_LABELS,
  SHARED_NODE_ATTRS,
  type CalloutTone,
  type EntryCover,
} from '@sone/core';

export interface ExportBlock {
  id: string;
  parentId: string | null;
  type: string;
  plainText: string;
  /** The text with its marks, as Markdown (ADR-0191). Falls back to plainText. */
  markdown?: string;
  props: Record<string, unknown>;
}

/** A file id out of the address the editor stores for a picture. */
export function fileIdFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const match = /^\/api\/files\/([0-9a-f-]{36})(?:[/?#]|$)/.exec(url);
  return match?.[1] ?? null;
}

/**
 * What a block carries that its Markdown spelling does not (ADR-0191): the
 * shared presentation (colour, alignment, width) for any block, and for a few
 * types the attributes Markdown has no place for. Written as one HTML comment
 * on the line after the block, which renderers drop and the importer attaches
 * to the block above it. Nothing to say, no comment.
 */
function blockComment(block: ExportBlock): string | null {
  const shape: Record<string, unknown> = {};
  for (const key of SHARED_NODE_ATTRS) {
    const value = props(block)[key];
    if (typeof value === 'string' && value !== '') shape[key] = value;
  }
  switch (block.type) {
    case 'toggle':
      // A toggle is a bold line in Markdown, which is what a paragraph in bold
      // is too. The comment is what tells them apart on the way back.
      shape['type'] = 'toggle';
      if (props(block)['collapsed'] === true) shape['collapsed'] = true;
      break;
    case 'file':
      shape['type'] = 'file';
      for (const key of ['filename', 'mimeType', 'category', 'sizeBytes', 'display']) {
        const value = props(block)[key];
        if (value !== undefined && value !== null && value !== '') shape[key] = value;
      }
      break;
    case 'image': {
      const display = props(block)['display'];
      if (typeof display === 'string') shape['display'] = display;
      break;
    }
    default:
      break;
  }
  return Object.keys(shape).length > 0 ? `<!-- sone-block ${JSON.stringify(shape)} -->` : null;
}

/** How deep a block sits, for the indentation lists need. */
function depths(blocks: ExportBlock[]): Map<string, number> {
  const parents = new Map(blocks.map((block) => [block.id, block.parentId]));
  const out = new Map<string, number>();

  for (const block of blocks) {
    let depth = 0;
    let at = block.parentId;
    // Bounded rather than trusted: a cycle in a projection would otherwise hang
    // an export, and an export that hangs is worse than one that flattens.
    while (at && depth < 32) {
      depth += 1;
      at = parents.get(at) ?? null;
    }
    out.set(block.id, depth);
  }
  return out;
}

function fence(type: string, props: Record<string, unknown>, text: string): string {
  const data = JSON.stringify(props);
  return ['```sone-' + type, data, ...(text ? [text] : []), '```'].join('\n');
}

/**
 * The page, as Markdown.
 *
 * One blank line between blocks, which is what every reader agrees on — and no
 * trailing whitespace, so a file that has not changed does not appear to have
 * changed when somebody puts an export under version control.
 */
/** What an entry is, apart from its title and its blocks. */
export interface ExportEntry {
  /** The `icon` value from the page map: symbol, symbol colour, title colour. */
  icon?: unknown;
  /** The band above the title, if any (ADR-0117). */
  cover?: EntryCover | null;
  /** 'column' or 'full'; null for the reader's default. */
  width?: string | null;
  template?: boolean;
  locked?: boolean;
}

export function pageToMarkdown(
  title: string,
  blocks: ExportBlock[],
  entry?: ExportEntry,
): string {
  const depth = depths(blocks);
  const lines: string[] = [];

  // The title as a level-one heading, and nothing else at that level: a page has
  // one name, and a reader that builds a table of contents should see it.
  lines.push(`# ${title || 'Untitled'}`);

  // The entry's own look — its symbol, the symbol's colour, the title's colour
  // — as an HTML comment right under the title, which Markdown renderers drop
  // and our importer reads (ADR-0190). Only when there is something to say: a
  // page with the default look gets no comment at all.
  if (entry) {
    const look: Record<string, unknown> = {};
    if (entry.icon !== undefined && entry.icon !== null) look['icon'] = entry.icon;
    if (entry.cover) {
      // A picture cover names its file the way an image block does, so the
      // importer can map it to the copy it uploads.
      const file = entry.cover.kind === 'image' ? fileIdFromUrl(entry.cover.url) : null;
      look['cover'] = file ? { kind: 'image', url: `attachments/${file}` } : entry.cover;
    }
    if (entry.width) look['width'] = entry.width;
    if (entry.template) look['template'] = true;
    if (entry.locked) look['locked'] = true;
    if (Object.keys(look).length > 0) {
      lines.push(`<!-- sone-entry ${JSON.stringify(look)} -->`);
    }
  }

  let numbering = 0;
  for (const block of blocks) {
    // The depth itself, not depth minus one: a top-level block has no parent
    // and so depth zero, and subtracting made a child of it indent by nothing.
    const indent = '  '.repeat(depth.get(block.id) ?? 0);
    // With its marks, where there are any (ADR-0191); code is text alone.
    const text = block.type === 'code' ? block.plainText : (block.markdown ?? block.plainText);

    if (block.type !== 'numberedList') numbering = 0;

    /*
     * By the block's real name.
     *
     * I wrote this switch against `heading-1`, `bullet` and `numbered`, which do
     * not exist — the types are `heading` with a `level`, `bulletList`,
     * `numberedList` and `collectionView` (see CoreBlockType). Every heading
     * and every list item was therefore exported as a plain paragraph, and my
     * tests passed because I had written them against the same invented names.
     * The list below is checked against core's own set by a test now.
     */
    switch (block.type) {
      case 'paragraph':
        lines.push(text);
        break;
      case 'heading': {
        // Demoted by one, because the title already holds level one: a document
        // with two `#` headings has two titles as far as a reader is concerned.
        const level = Number(props(block)['level'] ?? 1);
        const hashes = '#'.repeat(Math.min(6, Math.max(2, level + 1)));
        lines.push(`${hashes} ${text}`);
        break;
      }
      case 'bulletList':
        lines.push(`${indent}- ${text}`);
        break;
      case 'numberedList':
        numbering += 1;
        lines.push(`${indent}${numbering}. ${text}`);
        break;
      case 'todo':
        lines.push(`${indent}- [${props(block)['checked'] === true ? 'x' : ' '}] ${text}`);
        break;
      case 'quote': {
        // The source, when there is one, as a last line set off by a dash —
        // the way a quotation is attributed in print, and what the importer
        // reads back (ADR-0188).
        const source = props(block)['source'];
        lines.push(
          typeof source === 'string' && source.trim() !== ''
            ? `> ${text}\n>\n> — ${source.trim()}`
            : `> ${text}`,
        );
        break;
      }
      case 'callout': {
        // A blockquote with its first line naming what it is. Markdown has no
        // callout, and every dialect that invented one disagrees with the others.
        const tone = props(block)['tone'];
        const label =
          typeof tone === 'string' && tone in CALLOUT_TONE_LABELS
            ? CALLOUT_TONE_LABELS[tone as CalloutTone]
            : CALLOUT_TONE_LABELS.note;
        lines.push(`> **${label}**\n>\n> ${text}`);
        break;
      }
      case 'code': {
        const language = String(props(block)['language'] ?? '');
        lines.push('```' + language + '\n' + text + '\n```');
        break;
      }
      case 'divider': {
        // `---` for every reader; the line, symbol and place (ADR-0189) in an
        // HTML comment on the next line, which Markdown renderers drop and our
        // importer reads. A plain divider gets no comment at all.
        const shape: Record<string, string> = {};
        for (const key of ['rule', 'ornament', 'ornamentAt'] as const) {
          const value = props(block)[key];
          if (typeof value === 'string' && value !== '') shape[key] = value;
        }
        lines.push(
          Object.keys(shape).length > 0
            ? `---\n<!-- sone-divider ${JSON.stringify(shape)} -->`
            : '---',
        );
        break;
      }
      case 'toggle':
        // The summary as a bold line and the children after it, which is what a
        // reader without HTML sees anyway. `<details>` renders in some places
        // and appears as tags in others.
        lines.push(`**${text}**`);
        break;
      case 'image': {
        // A picture's file is in its address — `/api/files/<id>` — not in a
        // `fileId`, which an image block never had. Read from the address;
        // every exported picture used to come out as `![alt]()`, a frame
        // around nothing, and the file was never put in the archive.
        const alt = String(props(block)['alt'] ?? '');
        const file = props(block)['fileId'] ?? fileIdFromUrl(props(block)['url']);
        const url = typeof props(block)['url'] === 'string' ? String(props(block)['url']) : '';
        lines.push(
          file ? `![${alt}](attachments/${String(file)})` : url ? `![${alt}](${url})` : `![${alt}]()`,
        );
        break;
      }
      case 'file': {
        const file = props(block)['fileId'];
        const name = String(props(block)['filename'] ?? text ?? 'file');
        lines.push(file ? `[${name}](attachments/${String(file)})` : name);
        break;
      }
      default:
        // A collection, a table, an embed, a column: no Markdown spelling, so
        // the data goes in a fence our own importer can read back.
        lines.push(fence(block.type, block.props, text));
        break;
    }

    // On the line right under the block, the way the divider's shape is.
    const comment = blockComment(block);
    if (comment && lines.length > 0) lines[lines.length - 1] += `\n${comment}`;
  }

  return lines.join('\n\n').replace(/[ \t]+$/gm, '') + '\n';
}

function props(block: ExportBlock): Record<string, unknown> {
  return block.props ?? {};
}

/**
 * A name a file system will accept, from a page's title.
 *
 * Not a slug: an export is for reading, and "Übersicht 2026.md" is a better file
 * than "ubersicht-2026.md". Only the characters that actually break something are
 * replaced — the path separators, the ones Windows refuses, and a leading dot,
 * which would hide the file.
 */
export function fileNameFor(title: string, fallback: string): string {
  const cleaned = (title || fallback)
    // The control range written as an explicit class rather than a range with
    // literal control characters in the source, which lint refuses for the good
    // reason that they are invisible in a diff.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|]|[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned === '' ? fallback : cleaned;
}
