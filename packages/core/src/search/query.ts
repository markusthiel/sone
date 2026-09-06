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
  /** Folder names, lowercased — resolved at search time (ADR-0050). */
  in: string[];
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
const PREFIXES: Record<
  string,
  'tag' | 'author' | 'after' | 'before' | 'assigned' | 'in'
> = {
  assigned: 'assigned',
  zugewiesen: 'assigned',
  /*
   * A folder, by name (ADR-0050).
   *
   * ADR-0050 deferred this believing it needed an id in the query, because a
   * name does not survive a rename. It does not: `tag:` matches a key and not a
   * display name either, and the whole point of this syntax is that somebody
   * can type it and paste it to a colleague. A name resolved at search time is
   * shareable; an id is not.
   *
   * The cost is honest and visible: a rename changes what the query finds, and
   * two folders with one name match both. The chip says how many folders
   * matched, so ambiguity is on screen rather than silent.
   */
  in: 'in',
  ordner: 'in',
  folder: 'in',
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
    in: [],
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

    if (kind === 'in') filters.in.push(value.toLowerCase());
    else if (kind === 'assigned') filters.assigned.push(value.toLowerCase());
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
    filters.in.length > 0 ||
    filters.assigned.length > 0 ||
    filters.authors.length > 0 ||
    filters.after !== null ||
    filters.before !== null
  );
}

/**
 * Write filters back out as a query somebody could have typed (ADR-0118).
 *
 * The filter panel edits filters; the field edits a string; they are the same
 * search. So the panel parses what is in the field, changes one thing, and
 * writes it back through here rather than composing `tag:` itself.
 *
 * This is the same argument ADR-0050 made for putting the *parser* in core:
 *
 * > two parsers would eventually disagree about what somebody typed, which is
 * > the worst possible thing for a search box to be uncertain about
 *
 * A writer that disagrees with the reader is that fault with the halves
 * swapped, and it has a nastier shape: pressing a tag in the panel would
 * silently change something else in the field.
 *
 * **What could not be read is not written back.** `before:tuesday` is reported
 * as unreadable and struck through; re-asserting it on every edit would carry a
 * filter the search has already refused through the rest of the session, with
 * no way to be rid of it.
 *
 * The words go last, so somebody watching the field while pressing a tag sees
 * their words where they left them.
 */
export function buildSearchQuery(filters: SearchFilters): string {
  const parts: string[] = [];

  // Quoted only when it has to be. `tag:budget` is what somebody would type,
  // and `tag:"budget"` invites the question of whether the quotes mean
  // something — they do not, and a query that looks unlike the one you typed is
  // one you stop trusting.
  const write = (prefix: string, value: string): void => {
    parts.push(`${prefix}:${/[\s"]/.test(value) ? `"${value.replace(/"/g, '')}"` : value}`);
  };

  for (const tag of filters.tags) write('tag', tag);
  for (const name of filters.in) write('in', name);
  for (const author of filters.authors) write('author', author);
  for (const who of filters.assigned) write('assigned', who);
  if (filters.after) write('after', filters.after);
  if (filters.before) write('before', filters.before);
  if (filters.text !== '') parts.push(filters.text);

  return parts.join(' ');
}
