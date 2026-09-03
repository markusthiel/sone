/**
 * SONE server — where a page of a collection stops, and how the next one starts
 * (ADR-0055).
 *
 * A cursor rather than an offset. `OFFSET 5000` makes the database walk five
 * thousand rows to discard them, and — worse — a row inserted while somebody is
 * reading shifts every later page, so scrolling shows a row twice or skips one.
 * A keyset cursor is stable under insertion because it says *where it was*
 * rather than *how many it had passed*.
 */

/** How many rows a page holds by default, and at most. */
export const DEFAULT_PAGE = 50;
export const MAX_PAGE = 200;

/**
 * What a cursor carries: the sort values of the last row, and its id.
 *
 * The id is the tiebreaker and the reason a cursor works at all — two rows with
 * the same sort value need a total order, or paging either repeats one or loses
 * one. Every query here orders by the sort keys and then by `idx, id`.
 */
export interface PageCursor {
  keys: Array<string | number | null>;
  idx: string;
  id: string;
}

/**
 * Read a cursor from a query parameter.
 *
 * JSON in base64url. Opaque on purpose: a client that builds its own cursor is a
 * client depending on the shape of a sort, and the shape changes when somebody
 * adds a column to the view.
 */
export function readCursor(raw: string | null): PageCursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { keys, idx, id } = parsed as Record<string, unknown>;
    if (typeof idx !== 'string' || typeof id !== 'string') return null;
    if (!Array.isArray(keys)) return null;
    return {
      keys: keys.map((key) =>
        typeof key === 'string' || typeof key === 'number' ? key : null,
      ),
      idx,
      id,
    };
  } catch {
    // A cursor that cannot be read is treated as no cursor: somebody has an old
    // link or a truncated URL, and the first page is a better answer than an
    // error about a parameter they did not type.
    return null;
  }
}

export function writeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/**
 * The condition that says "after this row", for one page of a sorted set.
 *
 * Lexicographic over exactly the columns the sort names, then over `idx, id`.
 * Written out rather than using row-value comparison — `(a, b) > (x, y)` — for
 * two reasons: the sort directions can differ per column, which a row-value
 * comparison cannot express, and NULLs sort last here, which it cannot either.
 *
 * The shape is the standard one: for each key, "strictly past it" OR "equal to
 * it and past the rest".
 */
export function cursorCondition(
  orderKeys: Array<{ expr: string; direction: 'asc' | 'desc' }>,
  cursor: PageCursor,
  bind: (value: string | number | null) => string,
): string {
  const tail = `(p.idx, p.id) > (${bind(cursor.idx)}, ${bind(cursor.id)}::uuid)`;
  if (orderKeys.length === 0) return tail;

  const branches: string[] = [];
  for (let at = 0; at < orderKeys.length; at += 1) {
    const equals: string[] = [];
    for (let before = 0; before < at; before += 1) {
      const key = orderKeys[before]!;
      const value = cursor.keys[before] ?? null;
      // `IS NOT DISTINCT FROM` rather than `=`: a NULL key has to compare equal
      // to itself, or a page after a row with no value never advances.
      equals.push(`${key.expr} IS NOT DISTINCT FROM ${bind(value)}`);
    }

    const key = orderKeys[at]!;
    const value = cursor.keys[at] ?? null;
    const past =
      value === null
        ? // Past a NULL means nothing: NULLs sort last, so anything after a row
          // with no value is another row with no value, ordered by the tail.
          'false'
        : key.direction === 'desc'
          ? `(${key.expr} < ${bind(value)} OR ${key.expr} IS NULL)`
          : `(${key.expr} > ${bind(value)} AND ${key.expr} IS NOT NULL)`;

    branches.push([...equals, past].join(' AND '));
  }

  // And the last branch: every key equal, so the tiebreaker decides.
  const allEqual = orderKeys
    .map((key, at) => `${key.expr} IS NOT DISTINCT FROM ${bind(cursor.keys[at] ?? null)}`)
    .join(' AND ');
  branches.push(`${allEqual} AND ${tail}`);

  return `(${branches.map((branch) => `(${branch})`).join(' OR ')})`;
}
