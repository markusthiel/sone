/**
 * SONE core — reading filters out of a search query (ADR-0050).
 *
 * `tag:budget author:markus after:2026-08-01 rechnung` becomes three filters and
 * the word "rechnung". In core rather than in the server, because the interface
 * parses the same string to draw its chips — and two parsers would eventually
 * disagree about what somebody typed, which is the worst possible thing for a
 * search box to be uncertain about.
 */

/** What a filter could not be read as, so the interface can say which. */
export interface UnreadableFilter {
  prefix: string;
  value: string;
  reason: 'not_a_date';
}

export interface SearchFilters {
  /**
   * Whose tasks (ADR-0052), lowercased. `assigned:me` resolves on the server.
   *
   * Assigning is useless if nobody can list what they were given, and this is
   * the cheapest honest way there: the assignment is already projected, so the
   * question needed a filter and an index rather than a screen.
   */
  assigned: string[];
  /** Exact tags, lowercased. */
  tags: string[];
  /** Name prefixes, lowercased. */
  authors: string[];
  /** Inclusive, as dates in the workspace's own day — `YYYY-MM-DD`. */
  after: string | null;
  before: string | null;
  /** What is left to search for. */
  text: string;
  /** Filters that were typed and could not be used (ADR-0050). */
  unreadable: UnreadableFilter[];
}

/**
 * The prefixes, canonical first.
 *
 * English, deliberately: a translated prefix means a query that works for one
 * reader and not another, which breaks the sharing the syntax exists for. The
 * German ones are aliases rather than replacements — somebody typing `autor:`
 * has been perfectly clear, and refusing them would be pedantry.
 */
const PREFIXES: Record<string, 'tag' | 'author' | 'after' | 'before' | 'assigned'> = {
  assigned: 'assigned',
  zugewiesen: 'assigned',
  tag: 'tag',
  schlagwort: 'tag',
  author: 'author',
  autor: 'author',
  after: 'after',
  ab: 'after',
  seit: 'after',
  before: 'before',
  bis: 'before',
  vor: 'before',
};

/** `YYYY-MM-DD`, and a real day: 2026-02-30 is not one. */
function readDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Round-tripped, so a month that does not have a thirtieth is rejected rather
  // than rolled forward into the next one — which is what `Date` does silently.
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
}

/**
 * Split a query into filters and the words left over.
 *
 * Quoted values are kept whole: `tag:"Rechnung 2026"` is one tag. Everything
 * that is not a recognised prefix stays in the text, including a colon — a
 * search for `http://example.org` must not become a filter called `http`.
 */
export function parseSearchQuery(raw: string): SearchFilters {
  const filters: SearchFilters = {
    tags: [],
    authors: [],
    assigned: [],
    after: null,
    before: null,
    text: '',
    unreadable: [],
  };

  const words: string[] = [];
  // Words, or `prefix:"a quoted value"`, or `prefix:value`.
  const tokens = raw.match(/[^\s"]*"[^"]*"|[^\s]+/g) ?? [];

  for (const token of tokens) {
    const at = token.indexOf(':');
    if (at <= 0) {
      words.push(token);
      continue;
    }

    const prefix = token.slice(0, at).toLowerCase();
    const kind = PREFIXES[prefix];
    if (!kind) {
      // Not a filter — a URL, a time, or a word with a colon in it.
      words.push(token);
      continue;
    }

    const value = token.slice(at + 1).replace(/^"|"$/g, '').trim();
    if (value === '') {
      // `tag:` with nothing after it is somebody mid-typing. Dropped from the
      // text so it does not become a search term, and not reported as
      // unreadable either — there is nothing wrong with it yet.
      continue;
    }

    if (kind === 'assigned') filters.assigned.push(value.toLowerCase());
    else if (kind === 'tag') filters.tags.push(value.toLowerCase());
    else if (kind === 'author') filters.authors.push(value.toLowerCase());
    else {
      const date = readDate(value);
      if (!date) {
        // Reported rather than ignored: a search that returns results while
        // quietly dropping half of what was asked is worse than one that says
        // which half it could not use.
        filters.unreadable.push({ prefix: kind, value, reason: 'not_a_date' });
        continue;
      }
      if (kind === 'after') filters.after = date;
      else filters.before = date;
    }
  }

  filters.text = words.join(' ').trim();
  return filters;
}

/** Is there anything here to search with? */
export function hasSearchCriteria(filters: SearchFilters): boolean {
  return (
    filters.text.length >= 2 ||
    filters.tags.length > 0 ||
    filters.assigned.length > 0 ||
    filters.authors.length > 0 ||
    filters.after !== null ||
    filters.before !== null
  );
}
