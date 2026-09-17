/**
 * Inline text as Markdown, and Markdown back into inline text (ADR-0191).
 *
 * A mark lives in a Y.XmlText's formatting attributes, keyed by the mark's
 * name with the mark's attributes as the value — which is how y-prosemirror
 * writes them. So `[{insert:'bold', attributes:{strong:{}}}]` is a bold word,
 * and `{link:{href:'…'}}` is a link. Both directions here speak that shape, so
 * neither the exporter nor the importer needs ProseMirror.
 *
 * What is spelled: **strong**, *em*, ~~strikethrough~~, `inlineCode`,
 * [link](href "title"), and a mention as @Name (a name, not a link: the id
 * means nothing on another instance). Nothing else exists in the schema.
 *
 * Literal `*`, `_`, `` ` ``, `~`, `[` and `\` in the text are escaped on the way
 * out and unescaped on the way in, so a sentence about *pointers is not a
 * sentence in italics after a round trip.
 */

export interface InlineOp {
  insert: string;
  attributes?: Record<string, unknown>;
}

const MARK_ORDER = ['link', 'strong', 'em', 'strikethrough', 'inlineCode'] as const;

/** Characters that would be read as Markdown if left bare. */
const ESCAPE = /([\\*_`~[\]])/g;

export function escapeInline(text: string): string {
  return text.replace(ESCAPE, '\\$1');
}

function open(mark: string): string {
  switch (mark) {
    case 'strong':
      return '**';
    case 'em':
      return '*';
    case 'strikethrough':
      return '~~';
    case 'inlineCode':
      return '`';
    case 'link':
      return '[';
    default:
      return '';
  }
}

function close(mark: string, attrs: unknown): string {
  if (mark === 'link') {
    const raw = attrs && typeof attrs === 'object' ? (attrs as Record<string, unknown>) : {};
    const href = typeof raw['href'] === 'string' ? raw['href'] : '';
    const title = typeof raw['title'] === 'string' && raw['title'] !== '' ? raw['title'] : null;
    return title ? `](${href} "${title.replace(/"/g, '\\"')}")` : `](${href})`;
  }
  return open(mark);
}

/**
 * Delta ops to Markdown.
 *
 * Adjacent ops that share a mark keep it open across them: two bold ops in a
 * row are one `**…**`, not two. Marks close in reverse of the order they
 * opened, so the brackets nest.
 */
export function opsToMarkdown(ops: readonly InlineOp[]): string {
  let out = '';
  let active: Array<[string, unknown]> = [];

  const marksOf = (op: InlineOp): Array<[string, unknown]> => {
    const attrs = op.attributes ?? {};
    return MARK_ORDER.filter((name) => attrs[name] !== undefined && attrs[name] !== null).map(
      (name) => [name, attrs[name]] as [string, unknown],
    );
  };
  const same = (a: [string, unknown], b: [string, unknown] | undefined): boolean =>
    b !== undefined && a[0] === b[0] && JSON.stringify(a[1] ?? {}) === JSON.stringify(b[1] ?? {});

  /*
   * Whitespace at the edge of a marked run is moved outside the marks.
   *
   * `*` opens emphasis only before a non-space and closes only after one, so
   * a bold run that begins with a space — " and more", bold — would come out
   * as `** and more**`, which no reader takes as bold. The space is written
   * first, under whatever marks were already open, and the marks open at the
   * first letter. Trailing whitespace is held back the same way and written
   * before the next op's transitions.
   */
  let held = '';
  for (const op of ops) {
    const wanted = marksOf(op);
    const lead = /^\s*/.exec(op.insert)?.[0] ?? '';
    const trail = lead.length === op.insert.length ? '' : (/\s*$/.exec(op.insert)?.[0] ?? '');
    const core = op.insert.slice(lead.length, op.insert.length - trail.length);

    if (core === '') {
      held += op.insert;
      continue;
    }

    // How much of the open stack this op keeps, from the bottom.
    let keep = 0;
    while (keep < active.length && keep < wanted.length && same(active[keep]!, wanted[keep])) {
      keep += 1;
    }
    // Close against the last letter, then the whitespace, then open against
    // the next letter.
    for (let i = active.length - 1; i >= keep; i -= 1) {
      out += close(active[i]![0], active[i]![1]);
    }
    out += held + lead;
    held = trail;
    for (let i = keep; i < wanted.length; i += 1) {
      out += open(wanted[i]![0]);
    }
    active = wanted;
    const code = wanted.some(([name]) => name === 'inlineCode');
    // Inside code nothing is Markdown, so nothing is escaped — a backtick
    // inside code is the one thing this cannot spell, and it is rare enough
    // to be left as it is.
    out += code ? core : escapeInline(core);
  }
  for (let i = active.length - 1; i >= 0; i -= 1) {
    out += close(active[i]![0], active[i]![1]);
  }
  return out + held;
}

/**
 * Markdown to delta ops.
 *
 * A small, deliberate reader for the spellings above — not CommonMark. `*` and
 * `_` open emphasis only when the character after them is not a space, and
 * close only when the character before them is not a space, which is the rule
 * that keeps `2 * 3 * 4` arithmetic. Anything unmatched is text.
 */
export function markdownToOps(markdown: string): InlineOp[] {
  const ops: InlineOp[] = [];
  const marks: Record<string, unknown> = {};
  let buffer = '';

  const flush = (): void => {
    if (buffer === '') return;
    for (const name of Object.keys(marks)) since[name] = (since[name] ?? 0) + buffer.length;
    const attributes = { ...marks };
    ops.push(Object.keys(attributes).length > 0 ? { insert: buffer, attributes } : { insert: buffer });
    buffer = '';
  };
  /** Text written since each mark opened; a mark cannot close on nothing. */
  const since: Record<string, number> = {};
  const toggle = (name: string, value: unknown = {}): void => {
    flush();
    if (marks[name] !== undefined) {
      delete marks[name];
      delete since[name];
    } else {
      marks[name] = value;
      since[name] = 0;
    }
  };
  const hasContent = (name: string): boolean => (since[name] ?? 0) > 0 || buffer !== '';

  let i = 0;
  const n = markdown.length;
  const at = (k: number): string => markdown[k] ?? '';
  const canOpen = (k: number, len: number): boolean =>
    at(k + len) !== '' && !/\s/.test(at(k + len)) && hasCloser(k + len, markdown.slice(k, k + len));
  /** A later delimiter that could close this one; without it, the opener is a character. */
  const hasCloser = (from: number, delim: string): boolean => {
    // At least one character of content between opener and closer.
    let j = markdown.indexOf(delim, from + 1);
    while (j !== -1) {
      if (!/\s/.test(at(j - 1)) && at(j - 1) !== '\\') return true;
      j = markdown.indexOf(delim, j + delim.length);
    }
    return false;
  };
  const canClose = (k: number): boolean => k > 0 && !/\s/.test(at(k - 1));

  while (i < n) {
    const c = at(i);

    if (c === '\\' && i + 1 < n) {
      buffer += at(i + 1);
      i += 2;
      continue;
    }

    if (marks['inlineCode'] !== undefined) {
      if (c === '`') {
        toggle('inlineCode');
        i += 1;
      } else {
        buffer += c;
        i += 1;
      }
      continue;
    }

    if (c === '`') {
      // Only when a closing backtick exists; otherwise it is a backtick.
      if (markdown.indexOf('`', i + 1) !== -1) {
        toggle('inlineCode');
        i += 1;
        continue;
      }
    }

    if (c === '[') {
      const link = /^\[((?:\\.|[^\]\\])*)\]\(([^)\s]*)(?:\s+"((?:\\.|[^"\\])*)")?\)/.exec(markdown.slice(i));
      if (link) {
        flush();
        const inner = markdownToOps(link[1] ?? '');
        const attrs = { href: link[2] ?? '', title: link[3] ? link[3].replace(/\\"/g, '"') : null };
        for (const op of inner) {
          ops.push({
            insert: op.insert,
            attributes: { ...marks, ...(op.attributes ?? {}), link: attrs },
          });
        }
        i += link[0].length;
        continue;
      }
    }

    if (c === '*' && at(i + 1) === '*') {
      const opening = marks['strong'] === undefined;
      if ((opening && canOpen(i, 2)) || (!opening && canClose(i) && hasContent('strong'))) {
        toggle('strong');
        i += 2;
        continue;
      }
    }
    if (c === '~' && at(i + 1) === '~') {
      const opening = marks['strikethrough'] === undefined;
      if ((opening && canOpen(i, 2)) || (!opening && canClose(i) && hasContent('strikethrough'))) {
        toggle('strikethrough');
        i += 2;
        continue;
      }
    }
    if (c === '*' || c === '_') {
      const opening = marks['em'] === undefined;
      // `_` inside a word (snake_case) is a letter, not emphasis.
      const inWord = c === '_' && /\w/.test(at(i - 1)) && /\w/.test(at(i + 1));
      if (!inWord && ((opening && canOpen(i, 1)) || (!opening && canClose(i) && hasContent('em')))) {
        toggle('em');
        i += 1;
        continue;
      }
    }

    buffer += c;
    i += 1;
  }
  flush();

  // A mark still open at the end was never a mark: its opener was a
  // character. The words are kept; the mark is dropped from them.
  const open = Object.keys(marks);
  const cleaned = open.length === 0
    ? ops
    : ops.map((op) => {
        if (!op.attributes) return op;
        const attributes = { ...op.attributes };
        for (const name of open) delete attributes[name];
        return Object.keys(attributes).length > 0 ? { insert: op.insert, attributes } : { insert: op.insert };
      });

  // Adjacent ops with the same marks are one op, the way a delta would be.
  const merged: InlineOp[] = [];
  for (const op of cleaned) {
    const last = merged[merged.length - 1];
    if (last && JSON.stringify(last.attributes ?? {}) === JSON.stringify(op.attributes ?? {})) {
      last.insert += op.insert;
    } else {
      merged.push({ ...op });
    }
  }
  return merged;
}

/** The words alone, for anything that wants the text and not the marks. */
export function opsToText(ops: readonly InlineOp[]): string {
  return ops.map((op) => op.insert).join('');
}
