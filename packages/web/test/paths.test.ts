/**
 * URL contract tests.
 *
 * These guard a public contract (ADR-0016): a share link written into an email
 * today must still resolve in two years. Changing the shape here should require
 * changing a test, deliberately.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRoute, paths, slugify } from '../src/routes/paths.ts';

const PAGE = '00000000-0000-4000-8000-000000000001';

test('a page URL carries the id, and the slug is decorative', () => {
  // The id is the identity, so renaming a page never breaks a link.
  assert.equal(paths.page(PAGE, 'Quarterly Review'), `/p/${PAGE}/quarterly-review`);
  assert.equal(paths.page(PAGE), `/p/${PAGE}`);

  // Both forms parse to the same route, and a changed slug is ignored.
  assert.deepEqual(parseRoute(`/p/${PAGE}`), { kind: 'page', pageId: PAGE });
  assert.deepEqual(parseRoute(`/p/${PAGE}/anything-at-all`), {
    kind: 'page',
    pageId: PAGE,
  });
});

test('share links live in their own namespace', () => {
  // An anonymous visitor's URL must not be confusable with a member's: the two
  // carry different authorisation.
  assert.equal(paths.share('tok'), '/s/tok');
  assert.deepEqual(parseRoute('/s/tok'), { kind: 'share', token: 'tok', pageId: null });
});

test('a share link keeps its prefix while navigating its subtree', () => {
  // Otherwise clicking a subpage drops the credential and hits a login wall
  // mid-document.
  assert.equal(paths.sharePage('tok', PAGE, 'Sub Page'), `/s/tok/p/${PAGE}/sub-page`);
  assert.deepEqual(parseRoute(`/s/tok/p/${PAGE}/sub-page`), {
    kind: 'share',
    token: 'tok',
    pageId: PAGE,
  });
});

test('a malformed page id is a not-found route, not a failed request', () => {
  assert.deepEqual(parseRoute('/p/not-a-uuid'), { kind: 'notFound' });
  assert.deepEqual(parseRoute('/p/'), { kind: 'notFound' });
  assert.deepEqual(parseRoute('/s/tok/p/nope'), { kind: 'notFound' });
});

test('auth and utility routes parse', () => {
  assert.deepEqual(parseRoute('/'), { kind: 'home' });
  assert.deepEqual(parseRoute('/login'), { kind: 'login' });
  assert.deepEqual(parseRoute('/setup'), { kind: 'setup' });
  assert.deepEqual(parseRoute('/signup', '?invite=abc'), {
    kind: 'signup',
    invitationToken: 'abc',
  });
  assert.deepEqual(parseRoute('/search', '?q=budget'), {
    kind: 'search',
    query: 'budget',
  });
  assert.deepEqual(parseRoute('/settings'), { kind: 'settings', section: 'account' });
  assert.deepEqual(parseRoute('/settings/workspace'), {
    kind: 'settings',
    section: 'workspace',
  });
  assert.deepEqual(parseRoute('/nonsense'), { kind: 'notFound' });
});

test('no URL contains a workspace id', () => {
  // The session carries it, so a page moving between workspaces does not
  // invalidate every link to it.
  const built = [
    paths.home(),
    paths.login(),
    paths.signup('t'),
    paths.setup(),
    paths.search('q'),
    paths.settings(),
    paths.page(PAGE, 'Title'),
    paths.share('tok'),
    paths.sharePage('tok', PAGE, 'Title'),
  ];
  for (const url of built) {
    assert.ok(!url.includes('/w/'), `${url} must not contain a workspace segment`);
  }
});

test('tokens are path segments, never query parameters', () => {
  // Query strings leak into Referer headers on outbound links.
  assert.ok(!paths.share('secret').includes('?'));
  assert.ok(!paths.sharePage('secret', PAGE).includes('?'));
});

test('slugify handles accents, punctuation and length', () => {
  assert.equal(slugify('Übersicht'), 'ubersicht');
  assert.equal(slugify('Ärger & Freude!'), 'arger-freude');
  assert.equal(slugify('  spaced  out  '), 'spaced-out');
  assert.equal(slugify('---'), '');
  assert.ok(slugify('x'.repeat(200)).length <= 60);
});

test('slugify never produces a segment that changes the route', () => {
  // A slug containing a slash would add a path segment and break parsing.
  for (const title of ['a/b', '../etc', 'a?b=c', 'a#b', '../../']) {
    const url = paths.page(PAGE, title);
    assert.deepEqual(
      parseRoute(new URL(url, 'http://x').pathname),
      { kind: 'page', pageId: PAGE },
      `title ${JSON.stringify(title)} must not alter the route`,
    );
  }
});
