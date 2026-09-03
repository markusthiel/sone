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
