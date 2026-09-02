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

    if (block.type !== 'numbered') numbering = 0;

    switch (block.type) {
      case 'paragraph':
        lines.push(text);
        break;
      case 'heading-1':
        // Demoted by one, because the title already holds level one. A document
        // with two `#` headings has two titles as far as a reader is concerned.
        lines.push(`## ${text}`);
        break;
      case 'heading-2':
        lines.push(`### ${text}`);
        break;
      case 'heading-3':
        lines.push(`#### ${text}`);
        break;
      case 'bullet':
        lines.push(`${indent}- ${text}`);
        break;
      case 'numbered':
        numbering += 1;
        lines.push(`${indent}${numbering}. ${text}`);
        break;
      case 'todo':
        lines.push(`${indent}- [${props(block).checked === true ? 'x' : ' '}] ${text}`);
        break;
      case 'quote':
        lines.push(`> ${text}`);
        break;
      case 'callout':
        // A blockquote with its first line naming what it is. Markdown has no
        // callout, and every dialect that invented one disagrees with the others.
        lines.push(`> **${String(props(block).tone ?? 'Note')}**\n>\n> ${text}`);
        break;
      case 'code': {
        const language = String(props(block).language ?? '');
        lines.push('```' + language + '\n' + text + '\n```');
        break;
      }
      case 'divider':
        lines.push('---');
        break;
      case 'toggle':
        // The summary as a bold line and the children after it, which is what a
        // reader without HTML sees anyway. `<details>` would render in some
        // places and appear as tags in others.
        lines.push(`**${text}**`);
        break;
      case 'image': {
        const alt = String(props(block).alt ?? text ?? '');
        const file = props(block).fileId;
        lines.push(
          file ? `![${alt}](attachments/${String(file)})` : `![${alt}]()`,
        );
        break;
      }
      case 'file': {
        const file = props(block).fileId;
        const name = String(props(block).filename ?? text ?? 'file');
        lines.push(file ? `[${name}](attachments/${String(file)})` : name);
        break;
      }
      default:
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
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned === '' ? fallback : cleaned;
}
