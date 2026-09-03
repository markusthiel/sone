/**
 * SONE core — what changed between two versions of a page (ADR-0053).
 *
 * Not a text diff. Every block carries a stable id (ADR-0016), so the
 * correspondence between the two sides is *given* rather than guessed — and the
 * guess is where text diffs lie, by reporting a moved paragraph as a deletion in
 * one place and an insertion in another.
 *
 * In core because both the server (which computes it) and the interface (which
 * draws it) need the same vocabulary for the answer.
 */

/** A block as the projection has it: an id, a type, and its words. */
export interface DiffBlock {
  id: string;
  type: string;
  text: string;
}

export type WordChange =
  | { kind: 'same'; text: string }
  | { kind: 'added'; text: string }
  | { kind: 'removed'; text: string };

export type BlockChange =
  | { kind: 'added'; block: DiffBlock }
  | { kind: 'removed'; block: DiffBlock }
  | { kind: 'changed'; block: DiffBlock; words: WordChange[] }
  | { kind: 'moved'; block: DiffBlock; from: number; to: number };

export interface PageDiff {
  changes: BlockChange[];
  /**
   * Blocks that could not be matched by id.
   *
   * The projection can contain them — a document written by an importer or an
   * older build. They are the one place this behaves like a text diff, so the
   * count is reported and the interface says the comparison is approximate
   * rather than pretending it is exact.
   */
  unmatched: number;
}

/**
 * Words, for comparing inside one changed block.
 *
 * Not characters: character-level diffing of prose produces the noise everybody
 * recognises from a bad diff view — half a word marked, then two letters, then a
 * space. Words are what people read and edit in.
 */
function words(text: string): string[] {
  return text.split(/(\s+)/).filter((part) => part !== '');
}

/**
 * A word-level comparison of two strings.
 *
 * A longest-common-subsequence table, which is quadratic in the number of words
 * — bounded below rather than replaced, because a block is a paragraph and a
 * paragraph is tens of words. A block long enough to matter is reported as
 * wholly rewritten, which is what somebody reading it would conclude anyway.
 */
export function diffWords(before: string, after: string): WordChange[] {
  const a = words(before);
  const b = words(after);

  const LIMIT = 400;
  if (a.length > LIMIT || b.length > LIMIT) {
    return [
      { kind: 'removed', text: before },
      { kind: 'added', text: after },
    ];
  }

  // lengths[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] =
        a[i] === b[j]
          ? (lengths[i + 1]![j + 1] ?? 0) + 1
          : Math.max(lengths[i + 1]![j] ?? 0, lengths[i]![j + 1] ?? 0);
    }
  }

  const out: WordChange[] = [];
  /** Append, merging with the previous run of the same kind. */
  const push = (kind: WordChange['kind'], text: string): void => {
    const last = out.at(-1);
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text } as WordChange);
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]!);
      i += 1;
      j += 1;
    } else if ((lengths[i + 1]![j] ?? 0) >= (lengths[i]![j + 1] ?? 0)) {
      push('removed', a[i]!);
      i += 1;
    } else {
      push('added', b[j]!);
      j += 1;
    }
  }
  while (i < a.length) push('removed', a[i++]!);
  while (j < b.length) push('added', b[j++]!);

  return out;
}

/** Whether two texts differ by more than whitespace. */
function differs(before: string, after: string): boolean {
  return before.replace(/\s+/g, ' ').trim() !== after.replace(/\s+/g, ' ').trim();
}

/**
 * What changed from one version to another.
 *
 * The order of the result follows the *new* version, so reading the diff reads
 * like reading the page — with removed blocks appearing where they used to be
 * relative to what surrounds them.
 */
export function diffVersions(before: DiffBlock[], after: DiffBlock[]): PageDiff {
  const oldById = new Map<string, { block: DiffBlock; at: number }>();
  let unmatched = 0;

  before.forEach((block, at) => {
    if (block.id === '') {
      unmatched += 1;
      return;
    }
    oldById.set(block.id, { block, at });
  });

  const changes: BlockChange[] = [];
  const seen = new Set<string>();

  after.forEach((block, at) => {
    if (block.id === '') {
      unmatched += 1;
      return;
    }
    const was = oldById.get(block.id);
    if (!was) {
      changes.push({ kind: 'added', block });
      return;
    }
    seen.add(block.id);

    if (differs(was.block.text, block.text)) {
      changes.push({ kind: 'changed', block, words: diffWords(was.block.text, block.text) });
      return;
    }
    /*
     * Moved, not deleted-and-added.
     *
     * The property a text diff cannot have, and the reason this works on the
     * block model rather than on rendered text.
     *
     * The comparison is of *index*, which reports a block as moved when
     * something above it was added or removed — its own position did change,
     * and saying so is truer than saying nothing. The interface can be quiet
     * about a move of one.
     */
    if (was.at !== at) changes.push({ kind: 'moved', block, from: was.at, to: at });
  });

  // Everything the new version does not have, in the order it used to be in.
  for (const [id, was] of oldById) {
    if (!seen.has(id)) changes.push({ kind: 'removed', block: was.block });
  }

  return { changes, unmatched };
}
