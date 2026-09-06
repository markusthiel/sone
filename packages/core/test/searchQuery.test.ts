/**
 * Reading filters out of a search query (ADR-0050).
 *
 * The tests that matter are the ones about what is *not* a filter: a query with
 * a URL in it, a word with a colon, somebody mid-typing. A parser that turns
 * `http://example.org` into a filter called `http` is worse than no filters.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasSearchCriteria, parseSearchQuery } from '../src/search/query.js';

test('filters come out and the words stay', () => {
  const parsed = parseSearchQuery('tag:Budget author:Markus rechnung prüfen');
  assert.deepEqual(parsed.tags, ['budget']);
  assert.deepEqual(parsed.authors, ['markus']);
  assert.equal(parsed.text, 'rechnung prüfen');
});

test('a quoted value stays whole', () => {
  const parsed = parseSearchQuery('tag:"Rechnung 2026" offen');
  assert.deepEqual(parsed.tags, ['rechnung 2026']);
  assert.equal(parsed.text, 'offen');
});

test('a URL is not a filter', () => {
  // The test this parser exists to pass. `http:` is not a prefix, so the whole
  // token stays a search term.
  const parsed = parseSearchQuery('https://oc.example.org/s/abc link');
  assert.deepEqual(parsed.tags, []);
  assert.equal(parsed.text, 'https://oc.example.org/s/abc link');
});

test('the German prefixes are accepted as aliases', () => {
  // Somebody typing `autor:` has been perfectly clear, and refusing them would
  // be pedantry. The canonical form is English so a query is shareable between
  // two readers of different languages.
  const parsed = parseSearchQuery('autor:anna schlagwort:recht seit:2026-01-01');
  assert.deepEqual(parsed.authors, ['anna']);
  assert.deepEqual(parsed.tags, ['recht']);
  assert.equal(parsed.after, '2026-01-01');
});

test('a date that is not one is reported rather than dropped', () => {
  const parsed = parseSearchQuery('after:letzte-woche rechnung');
  assert.deepEqual(parsed.unreadable, [
    { prefix: 'after', value: 'letzte-woche', reason: 'not_a_date' },
  ]);
  assert.equal(parsed.after, null);
  // And the rest of the search still runs.
  assert.equal(parsed.text, 'rechnung');
});

test('a day that does not exist is not a date', () => {
  // `new Date(2026, 1, 30)` rolls silently into March, which would make
  // `before:2026-02-30` mean something nobody asked for.
  assert.equal(parseSearchQuery('before:2026-02-30').before, null);
  assert.equal(parseSearchQuery('before:2026-02-28').before, '2026-02-28');
});

test('a prefix with nothing after it is somebody mid-typing', () => {
  // Not an error and not a search term: `tag:` on its own is a half-typed
  // filter, and searching for the word "tag" is not what was meant.
  const parsed = parseSearchQuery('tag: rechnung');
  assert.deepEqual(parsed.tags, []);
  assert.deepEqual(parsed.unreadable, []);
  assert.equal(parsed.text, 'rechnung');
});

test('a filter alone is a valid search', () => {
  // "Show me everything tagged X" is a question people ask constantly and
  // currently cannot ask at all. The two-character minimum is about a *guess*,
  // and a filter is not one.
  assert.equal(hasSearchCriteria(parseSearchQuery('tag:rechnung')), true);
  assert.equal(hasSearchCriteria(parseSearchQuery('a')), false, 'one letter still is not');
  assert.equal(hasSearchCriteria(parseSearchQuery('')), false);
});

test('assigned: comes out, and "me" is left for the server', () => {
  // The parser has no idea who is asking, and inventing a way for it to know
  // would mean passing a session into a pure function. "me" travels as the
  // word it is and the server resolves it (ADR-0052).
  const parsed = parseSearchQuery('assigned:me rechnung');
  assert.deepEqual(parsed.assigned, ['me']);
  assert.equal(parsed.text, 'rechnung');

  // And it alone is a search, like every other filter.
  assert.equal(hasSearchCriteria(parseSearchQuery('assigned:me')), true);
  assert.deepEqual(parseSearchQuery('zugewiesen:anna').assigned, ['anna']);
});

test('a folder is named, not identified', () => {
  // ADR-0050 deferred this believing it needed an id in the query, because a
  // name does not survive a rename. It does not: `tag:` matches a key rather
  // than a display name either, and the point of this syntax is that somebody
  // can type it and paste it to a colleague. An id is not that.
  assert.deepEqual(parseSearchQuery('in:Projekte Rechnung').in, ['projekte']);
  assert.equal(parseSearchQuery('in:Projekte Rechnung').text, 'Rechnung');
  // German too, like every other prefix.
  assert.deepEqual(parseSearchQuery('ordner:Archiv').in, ['archiv']);
  // And it counts as a criterion on its own: `in:Projekte` with no words is a
  // question about a place.
  assert.ok(hasSearchCriteria(parseSearchQuery('in:Projekte')));
});

// --- writing one back (ADR-0118) -------------------------------------------

import { buildSearchQuery } from '../src/search/query.js';

/**
 * The filter panel edits filters and the field edits a string, and they are the
 * same search.
 *
 * So the panel does not compose `tag:` by hand: it parses what is in the field,
 * changes one thing, and writes it back through this. Two places assembling the
 * syntax is the arrangement ADR-0050 already refused for *reading* it — "two
 * parsers would eventually disagree about what somebody typed, which is the
 * worst possible thing for a search box to be uncertain about" — and a writer
 * that disagrees with the reader is the same fault with the halves swapped.
 */

test('what is written back parses to what went in', () => {
  const filters = parseSearchQuery(
    'tag:budget tag:"rechnung 2026" in:Finanzen author:markus assigned:me ' +
      'after:2026-01-01 before:2026-12-31 quartal prüfen',
  );

  const again = parseSearchQuery(buildSearchQuery(filters));

  assert.deepEqual(again.tags, filters.tags);
  assert.deepEqual(again.in, filters.in);
  assert.deepEqual(again.authors, filters.authors);
  assert.deepEqual(again.assigned, filters.assigned);
  assert.equal(again.after, filters.after);
  assert.equal(again.before, filters.before);
  assert.equal(again.text, filters.text);
});

test('a value with a space comes back quoted, or it is two filters', () => {
  // The one case that cannot survive a naive join, and the reason this is a
  // function rather than a template string at each call site.
  const written = buildSearchQuery(parseSearchQuery('tag:"rechnung 2026"'));
  assert.match(written, /tag:"rechnung 2026"/);
  assert.deepEqual(parseSearchQuery(written).tags, ['rechnung 2026']);
});

test('the words come last, so a half-typed filter is still readable', () => {
  // Somebody watching the field while pressing a tag in the panel should see
  // their words where they left them, not shuffled into the middle.
  const written = buildSearchQuery(parseSearchQuery('quartal tag:budget prüfen'));
  assert.equal(written, 'tag:budget quartal prüfen');
});

test('nothing chosen is an empty string, not a string of nothings', () => {
  // The field has to be *empty* for the saved searches and the syntax note to
  // appear under it, and " " is not empty.
  assert.equal(buildSearchQuery(parseSearchQuery('')), '');
});

test('what could not be read is not written back', () => {
  /*
   * `before:tuesday` is reported to the person as unreadable and struck through
   * (ADR-0050). Writing it back would mean pressing a tag in the panel silently
   * re-asserting a filter the search had already told them it could not use —
   * and it would never go away, because every edit would carry it forward.
   */
  const filters = parseSearchQuery('before:tuesday tag:budget');
  assert.equal(filters.unreadable.length, 1);

  const written = buildSearchQuery(filters);
  assert.equal(written, 'tag:budget');
});
