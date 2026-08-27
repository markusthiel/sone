/**
 * SONE — pasting markdown.
 *
 * Text copied from anywhere that writes markdown — another notes app, a README,
 * a chat client, an LLM — arrived as literal characters: `## Heading` stayed a
 * paragraph reading "## Heading", and a list of `- item` lines became one
 * paragraph with hyphens in it. Every import had to be reformatted by hand.
 *
 * A deliberately small subset, converted only when the pasted text is
 * *recognisably* markdown. Two reasons for that restraint:
 *
 *   - Someone pasting a code sample, a shell transcript or a quotation does not
 *     want it silently restructured. Guessing wrong destroys content, and the
 *     person may not notice until much later.
 *   - HTML paste is handled by ProseMirror's own parser, which is better than
 *     anything written here. This only runs for plain text.
 *
 * Inline marks (`**bold**`, `*italic*`, `` `code` ``, `[text](url)`) are applied
 * within a line. Nested and overlapping emphasis is not attempted: a real
 * markdown parser is a dependency-sized problem, and half-parsing produces
 * wrong output rather than plain output.
 */

import { BLOCK_ATTRS } from '@sone/core';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';

import { normaliseHref } from './links.js';
import { schema, writeIndent, writeProps } from './schema.js';

/** A parsed line, before it becomes a node. */
interface ParsedBlock {
  type: string;
  text: string;
  indent: number;
  attrs?: Record<string, unknown>;
  props?: Record<string, unknown>;
}

/**
 * Does this text look like markdown worth converting?
 *
 * Requires a structural marker at the start of a line. A paragraph containing an
 * asterisk is not markdown; a line beginning `## ` is.
 *
 * Deliberately strict. The cost of a false positive — restructuring text
 * somebody wanted verbatim — is much higher than the cost of a false negative,
 * which is a paste they format themselves.
 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split('\n');
  return lines.some((line) =>
    /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|\s*[-*+]\s\[[ xX]\]\s|\[[ xX]\]\s)/.test(line),
  );
}

const INDENT_PER_LEVEL = 2;

/**
 * Split markdown text into blocks.
 *
 * Exported for tests: the line-classification rules are where this is either
 * right or quietly wrong, and they are worth pinning down without a document.
 */
export function parseMarkdownBlocks(text: string): ParsedBlock[] {
  // Normalised line endings first: text pasted from Windows or from a browser
  // arrives with \r\n, and a trailing \r turns every pattern match into a miss.
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ParsedBlock[] = [];

  let fence: { language: string | null; lines: string[] } | null = null;

  for (const line of lines) {
    // --- fenced code ---
    const fenceMatch = /^\s*```\s*([a-zA-Z0-9+#._-]*)\s*$/.exec(line);
    if (fenceMatch) {
      if (fence) {
        blocks.push({
          type: 'code',
          text: fence.lines.join('\n'),
          indent: 0,
          attrs: { language: fence.language },
        });
        fence = null;
      } else {
        fence = { language: fenceMatch[1] || null, lines: [] };
      }
      continue;
    }
    if (fence) {
      // Inside a fence everything is content, including blank lines and
      // anything that would otherwise look like a heading.
      fence.lines.push(line);
      continue;
    }

    // A blank line separates blocks; it does not become one. An empty paragraph
    // per blank line would double the spacing of every pasted document.
    if (line.trim() === '') continue;

    const leading = line.length - line.trimStart().length;
    const indent = Math.min(Math.floor(leading / INDENT_PER_LEVEL), 6);
    const content = line.trim();

    const heading = /^(#{1,6})\s+(.*)$/.exec(content);
    if (heading) {
      blocks.push({
        type: 'heading',
        text: heading[2]!,
        indent: 0,
        props: { level: heading[1]!.length },
      });
      continue;
    }

    // Checked before the bullet rule: "- [ ] task" also matches a bullet, and
    // the more specific pattern has to win.
    const todo = /^[-*+]?\s*\[([ xX])\]\s+(.*)$/.exec(content);
    if (todo) {
      blocks.push({
        type: 'todo',
        text: todo[2]!,
        indent,
        attrs: { checked: todo[1]!.toLowerCase() === 'x' },
      });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(content);
    if (bullet) {
      blocks.push({ type: 'bulletList', text: bullet[1]!, indent });
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(content);
    if (numbered) {
      blocks.push({ type: 'numberedList', text: numbered[1]!, indent });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(content);
    if (quote) {
      blocks.push({ type: 'quote', text: quote[1]!, indent });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(content)) {
      blocks.push({ type: 'divider', text: '', indent: 0 });
      continue;
    }

    blocks.push({ type: 'paragraph', text: content, indent });
  }

  // An unterminated fence still becomes a code block. Dropping the text because
  // the closing ``` is missing would lose content, which is never the right
  // trade.
  if (fence) {
    blocks.push({
      type: 'code',
      text: fence.lines.join('\n'),
      indent: 0,
      attrs: { language: fence.language },
    });
  }

  return blocks;
}

/** Inline patterns, longest delimiter first so `**` wins over `*`. */
const INLINE_PATTERNS: Array<{ mark: string; pattern: RegExp; group: number }> = [
  { mark: 'strong', pattern: /\*\*([^*]+)\*\*/, group: 1 },
  { mark: 'strong', pattern: /__([^_]+)__/, group: 1 },
  { mark: 'em', pattern: /(?<!\*)\*([^*]+)\*(?!\*)/, group: 1 },
  { mark: 'em', pattern: /(?<!_)_([^_]+)_(?!_)/, group: 1 },
  { mark: 'strikethrough', pattern: /~~([^~]+)~~/, group: 1 },
  { mark: 'inlineCode', pattern: /`([^`]+)`/, group: 1 },
];

/**
 * Convert one line of markdown into inline nodes.
 *
 * Single-pass and non-recursive: nested emphasis is left as literal characters
 * rather than half-parsed. Wrong output is worse than plain output, because
 * plain output is obvious and can be fixed.
 */
export function parseInline(text: string): PMNode[] {
  if (text === '') return [];

  // Links first: their label may contain characters the emphasis patterns would
  // otherwise consume.
  const link = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(text);
  if (link) {
    const href = normaliseHref(link[2]!);
    const linkType = schema.marks['link'];
    const before = text.slice(0, link.index);
    const after = text.slice(link.index + link[0].length);
    const label = link[1] || link[2]!;

    const middle =
      href && linkType
        ? [schema.text(label, [linkType.create({ href })])]
        : // An address that cannot be linked keeps its literal text, so nothing
          // is lost and the person can see why.
          [schema.text(link[0])];

    return [...parseInline(before), ...middle, ...parseInline(after)];
  }

  for (const { mark, pattern, group } of INLINE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;

    const type = schema.marks[mark];
    if (!type) continue;

    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    const inner = match[group]!;

    return [
      ...parseInline(before),
      schema.text(inner, [type.create()]),
      ...parseInline(after),
    ];
  }

  return [schema.text(text)];
}

/**
 * Build a slice from markdown text.
 *
 * Returns null when the text does not look like markdown, so the caller can let
 * the default paste happen rather than routing plain text through here.
 *
 * Block ids are left null: the blockIds plugin assigns them on the next
 * transaction, which is the only place that knows how to keep them unique.
 * Pasting a document with ids copied from somewhere else would give two blocks
 * the same primary key in the projection.
 */
export function markdownToSlice(text: string): Slice | null {
  if (!looksLikeMarkdown(text)) return null;

  const parsed = parseMarkdownBlocks(text);
  if (parsed.length === 0) return null;

  const nodes: PMNode[] = [];

  for (const block of parsed) {
    const type = schema.nodes[block.type] ?? schema.nodes['paragraph'];
    if (!type) continue;

    const attrs: Record<string, unknown> = {
      ...block.attrs,
      [BLOCK_ATTRS.id]: null,
      [BLOCK_ATTRS.props]: block.props ? writeProps(block.props) : null,
      [BLOCK_ATTRS.indent]: writeIndent(block.indent),
    };

    // Heading level is a schema attribute as well as a prop, so it has to be
    // set both ways or the rendered heading is the default size.
    if (block.props && typeof block.props['level'] === 'number') {
      attrs['level'] = block.props['level'];
    }

    if (block.type === 'divider') {
      nodes.push(type.create(attrs));
      continue;
    }

    if (block.type === 'code') {
      // Code content is text only, with no marks — asterisks in a code sample
      // are asterisks.
      nodes.push(type.create(attrs, block.text ? schema.text(block.text) : null));
      continue;
    }

    nodes.push(type.create(attrs, Fragment.fromArray(parseInline(block.text))));
  }

  if (nodes.length === 0) return null;

  // openStart and openEnd of 0: the pasted blocks are complete, so they are
  // inserted as blocks rather than merged into the one being pasted into.
  return new Slice(Fragment.fromArray(nodes), 0, 0);
}

/**
 * The paste plugin.
 *
 * Only handles plain text. HTML paste goes to ProseMirror's own parser, which is
 * better than anything here — and text copied from a rendered page arrives as
 * HTML, so this path is for text that was markdown to begin with.
 */
export function markdownPaste(): Plugin {
  return new Plugin({
    key: new PluginKey('sone-markdown-paste'),
    props: {
      handlePaste(view, event) {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;

        // HTML present means the source had structure; let the real parser have
        // it.
        if (clipboard.getData('text/html')) return false;

        const text = clipboard.getData('text/plain');
        if (!text) return false;

        // Never inside a code block: markdown in code is code.
        const { $from } = view.state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          if ($from.node(depth).type.spec.code) return false;
        }

        const slice = markdownToSlice(text);
        if (!slice) return false;

        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
  });
}
