/**
 * SONE server — Markdown back into blocks (ADR-0044).
 *
 * The other half of the round trip. Deliberately not a full Markdown
 * implementation: this reads the shape our own export writes, plus the parts of
 * CommonMark that any tool produces for the same shapes — headings, lists,
 * quotes, code fences, rules. Anything it does not recognise becomes a
 * paragraph, which is the one failure mode that loses nothing.
 *
 * That is a decision rather than a shortcut. A complete Markdown parser is a
 * dependency and a moving target, and the archives that will actually be
 * imported are ours, Obsidian's, and whatever somebody's notes app wrote — all
 * of which agree about the shapes above and disagree about everything else.
 *
 * Inline marks are *not* parsed. `**bold**` arrives as literal asterisks, and
 * that is stated here because it is the honest limit of this pass: marks live in
 * a Yjs text's formatting, and applying them means a second parser and a second
 * set of decisions about overlapping ranges. Better a page whose words are all
 * present than one where half of them vanished into a mark I got wrong.
 */

export interface ParsedBlock {
  type: string;
  text: string;
  props: Record<string, unknown>;
  /** Nesting, from list indentation. Zero for a top-level block. */
  indent: number;
}

/** A fenced block our own export wrote, carrying its own data. */
const SONE_FENCE = /^```sone-([A-Za-z][\w-]*)\s*$/;

export function markdownToBlocks(markdown: string): ParsedBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ParsedBlock[] = [];
  let at = 0;

  while (at < lines.length) {
    const line = lines[at] ?? '';

    if (line.trim() === '') {
      at += 1;
      continue;
    }

    // A block we wrote ourselves: its type and props are in the fence, so this
    // is the path that makes a collection survive an export and an import.
    const sone = SONE_FENCE.exec(line.trim());
    if (sone) {
      const { body, next } = readFence(lines, at + 1);
      at = next;
      const [first, ...rest] = body;
      let props: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(first ?? '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          props = parsed as Record<string, unknown>;
        }
      } catch {
        // Data we wrote and cannot read back. The block is kept as a paragraph
        // holding the text rather than dropped: something is better than a hole
        // where a table was, and a hole is what a stricter reader would leave.
        blocks.push({ type: 'paragraph', text: (body ?? []).join('\n'), props: {}, indent: 0 });
        continue;
      }
      blocks.push({ type: sone[1] ?? 'paragraph', text: rest.join('\n'), props, indent: 0 });
      continue;
    }

    // An ordinary code fence keeps its language and its content verbatim.
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence) {
      const { body, next } = readFence(lines, at + 1);
      at = next;
      blocks.push({
        type: 'code',
        text: body.join('\n'),
        props: fence[1] ? { language: fence[1] } : {},
        indent: 0,
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      at += 1;
      // Promoted by one, undoing the export's demotion: the file's `#` is the
      // page title and is stripped before this runs, so `##` was our `heading`
      // at level 1.
      const level = Math.max(1, (heading[1] ?? '#').length - 1);
      blocks.push({ type: 'heading', text: heading[2] ?? '', props: { level }, indent: 0 });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      at += 1;
      blocks.push({ type: 'divider', text: '', props: {}, indent: 0 });
      continue;
    }

    /*
     * A picture on its own line, which is what the export writes.
     *
     * Before the list patterns, because `![alt](x)` starts with no marker but a
     * line like `- ![alt](x)` would otherwise become a bullet holding literal
     * Markdown. And an image needs to be an `image` block rather than a
     * paragraph: as a paragraph it arrives as the characters `![…]`, which is
     * how an imported page ends up describing its own pictures instead of
     * showing them.
     */
    const image = /^!\[([^\]]*)\]\((.*?)\)\s*$/.exec(line.trim());
    if (image) {
      at += 1;
      const target = image[2] ?? '';
      const attachment = /^attachments\/(.+)$/.exec(target);
      blocks.push({
        type: 'image',
        text: '',
        props: attachment
          // The archive's own id, which the importer maps to the file it
          // uploads. An `attachmentRef` rather than a `fileId`, so a block that
          // was never resolved is visibly unresolved instead of pointing at a
          // file id that means nothing here.
          ? { alt: image[1] ?? '', attachmentRef: attachment[1] }
          // A picture somewhere else on the web. Kept as it was: rewriting it
          // would mean downloading somebody else's server on import.
          : { alt: image[1] ?? '', url: target },
        indent: 0,
      });
      continue;
    }

    const todo = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (todo) {
      at += 1;
      blocks.push({
        type: 'todo',
        text: todo[3] ?? '',
        props: { checked: (todo[2] ?? ' ').toLowerCase() === 'x' },
        indent: indentOf(todo[1] ?? ''),
      });
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      at += 1;
      blocks.push({
        type: 'bulletList',
        text: bullet[2] ?? '',
        props: {},
        indent: indentOf(bullet[1] ?? ''),
      });
      continue;
    }

    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      at += 1;
      blocks.push({
        type: 'numberedList',
        text: numbered[2] ?? '',
        props: {},
        indent: indentOf(numbered[1] ?? ''),
      });
      continue;
    }

    if (line.startsWith('>')) {
      // Consecutive quote lines are one quote, which is what they look like.
      const parts: string[] = [];
      while (at < lines.length && (lines[at] ?? '').startsWith('>')) {
        parts.push((lines[at] ?? '').replace(/^>\s?/, ''));
        at += 1;
      }
      blocks.push({
        type: 'quote',
        text: parts.join('\n').trim(),
        props: {},
        indent: 0,
      });
      continue;
    }

    // A paragraph runs until a blank line, and its line breaks are kept: a
    // wrapped sentence in a file was one sentence, and joining with a space
    // would be right for prose and wrong for an address.
    const parts: string[] = [];
    while (at < lines.length && (lines[at] ?? '').trim() !== '' && !isBlockStart(lines[at] ?? '')) {
      parts.push(lines[at] ?? '');
      at += 1;
    }
    blocks.push({ type: 'paragraph', text: parts.join('\n'), props: {}, indent: 0 });
  }

  return blocks;
}

/** Two spaces per level, which is what our export writes and what most tools do. */
function indentOf(spaces: string): number {
  return Math.floor(spaces.replace(/\t/g, '  ').length / 2);
}

function isBlockStart(line: string): boolean {
  return (
    /^#{1,6}\s/.test(line) ||
    /^```/.test(line) ||
    /^\s*[-*+]\s/.test(line) ||
    /^\s*\d+[.)]\s/.test(line) ||
    line.startsWith('>') ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())
  );
}

/** A fence's body, and the line after its closing marker. */
function readFence(lines: string[], from: number): { body: string[]; next: number } {
  const body: string[] = [];
  let at = from;
  while (at < lines.length && (lines[at] ?? '').trim() !== '```') {
    body.push(lines[at] ?? '');
    at += 1;
  }
  // Past the closing fence, or past the end when there is none: an unterminated
  // fence is a file somebody truncated, and taking the rest as its body loses
  // less than refusing the file.
  //
  // Trailing blank lines dropped in that case, because they are the file's own
  // final newline rather than content — a closed fence has no such lines, so
  // this only touches the truncated case.
  while (at >= lines.length && body.at(-1)?.trim() === '') body.pop();
  return { body, next: at + 1 };
}
