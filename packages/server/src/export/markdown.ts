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

import { CALLOUT_TONE_LABELS, type CalloutTone } from '@sone/core';

export interface ExportBlock {
  id: string;
  parentId: string | null;
  type: string;
  plainText: string;
  props: Record<string, unknown>;
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
export function pageToMarkdown(title: string, blocks: ExportBlock[]): string {
  const depth = depths(blocks);
  const lines: string[] = [];

  // The title as a level-one heading, and nothing else at that level: a page has
  // one name, and a reader that builds a table of contents should see it.
  lines.push(`# ${title || 'Untitled'}`);

  let numbering = 0;
  for (const block of blocks) {
    // The depth itself, not depth minus one: a top-level block has no parent
    // and so depth zero, and subtracting made a child of it indent by nothing.
    const indent = '  '.repeat(depth.get(block.id) ?? 0);
    const text = block.plainText;

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
        const alt = String(props(block)['alt'] ?? text ?? '');
        const file = props(block)['fileId'];
        lines.push(file ? `![${alt}](attachments/${String(file)})` : `![${alt}]()`);
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
