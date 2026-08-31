/**
 * URL contract tests.
 *
 * These guard a public contract (ADR-0016): a share link written into an email
 * today must still resolve in two years. Changing the shape here should require
 * changing a test, deliberately.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

import {
  MOVED_SETTINGS,
  blockFromHash,
  parseRoute,
  paths,
  slugify,
} from '../src/routes/paths.ts';

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
  // Three areas, three spaces (ADR-0032). The default section is named here
  // rather than derived, so a link to the area alone is a link to something.
  assert.deepEqual(parseRoute('/settings'), { kind: 'settings', section: 'profile' });
  assert.deepEqual(parseRoute('/settings/appearance'), {
    kind: 'settings',
    section: 'appearance',
  });
  assert.deepEqual(parseRoute('/workspace'), {
    kind: 'workspaceSettings',
    section: 'general',
  });
  assert.deepEqual(parseRoute('/workspace/typography'), {
    kind: 'workspaceSettings',
    section: 'typography',
  });
  assert.deepEqual(parseRoute('/admin'), { kind: 'admin', section: 'instance' });
  assert.deepEqual(parseRoute('/admin/sso'), { kind: 'admin', section: 'sso' });
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

// --- share links ------------------------------------------------------------

test('a share link without a page parses, and says so', () => {
  // It has to parse: every link created before the page was added to the URL
  // looks like this, and a share link is a public contract (ADR-0016). What
  // must not happen is the client treating a null page as "wait forever",
  // which is what produced an endless "Opening…".
  const route = parseRoute('/s/abc123');
  assert.deepEqual(route, { kind: 'share', token: 'abc123', pageId: null });
});

test('a share link with a page carries it', () => {
  const route = parseRoute('/s/abc123/p/11111111-1111-4111-8111-111111111111');
  assert.deepEqual(route, {
    kind: 'share',
    token: 'abc123',
    pageId: '11111111-1111-4111-8111-111111111111',
  });
});

test('a decorative slug on a share link is ignored', () => {
  // Titles change; the id is what identifies the page.
  const route = parseRoute(
    '/s/abc123/p/11111111-1111-4111-8111-111111111111/some-old-title',
  );
  assert.equal(route.kind, 'share');
  assert.equal(
    route.kind === 'share' ? route.pageId : null,
    '11111111-1111-4111-8111-111111111111',
  );
});

test('a share link with a page still needs the token resolved', () => {
  // Not a routing rule but the reason the route alone is not enough: resolving
  // the token is what sets the share cookie, which is the visitor's only
  // credential for ordinary HTTP requests. Putting the page in the path made
  // the client skip that call, and every image upload through a shared link
  // was refused as a result.
  const source = codeOf(new URL('../src/App.tsx', import.meta.url));

  // The guard that caused it must not come back.
  assert.doesNotMatch(
    source,
    /if \(pageId !== null\) return;/,
    'the token must be resolved even when the path carries a page',
  );
  assert.match(source, /resolveShare\(token\)/);
});

test('a share visitor is not asked for their name on every reload', () => {
  // Asking again on a refresh is an omission rather than a decision: nothing
  // about the name is worth re-deciding, and a reload is not a new visit.
  const source = codeOf(new URL('../src/App.tsx', import.meta.url));

  // Per token and per tab: two tabs are two people to presence, and a
  // different link is a different circle of people.
  assert.match(source, /sone\.share\.name\.\$\{token\}/);
  assert.match(source, /sessionStorage/);
  assert.doesNotMatch(
    source,
    /localStorage\.setItem\(nameKey/,
    'a name on a shared machine should not outlive the browser session',
  );
});

test('an old settings URL is redirected, not answered', () => {
  // They are in the sidebar, in the switcher and in whatever anybody has
  // bookmarked, and a URL is a public contract (ADR-0016). Landing on the first
  // section of the wrong area would be worse than a not-found page, because it
  // looks like it worked.
  assert.equal(MOVED_SETTINGS['account'], '/settings/profile');
  assert.equal(MOVED_SETTINGS['theme'], '/workspace/typography');
  assert.equal(MOVED_SETTINGS['groups'], '/workspace/groups');
  assert.equal(MOVED_SETTINGS['sso'], '/admin/sso');
  assert.equal(MOVED_SETTINGS['workspaces'], '/admin/workspaces');

  // Every target is a real route, or the redirect sends somebody nowhere.
  for (const target of Object.values(MOVED_SETTINGS)) {
    const route = parseRoute(target);
    assert.notEqual(route.kind, 'notFound', `${target} is a route`);
  }

  // And nothing that still exists is redirected away from itself.
  for (const kept of ['appearance', 'landing', 'about']) {
    assert.equal(MOVED_SETTINGS[kept], undefined, `${kept} stays where it is`);
  }

  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /navigate\(moved, \{ replace: true \}\)/, 'replaced, not pushed');
});

test('a page URL can name a block, as a fragment', () => {
  // A position within a page rather than a different page, and a fragment never
  // reaches the server — right for something only the interface acts on
  // (ADR-0033).
  const url = paths.page(PAGE, 'Heat pump costs', 'block-1');
  assert.ok(url.startsWith(`/p/${PAGE}/heat-pump-costs#`));
  assert.equal(blockFromHash(new URL(url, 'http://x').hash), 'block-1');

  // Absent and null both mean "the page itself", so a result with no matching
  // block does not produce a dangling fragment.
  assert.equal(paths.page(PAGE, 'A').includes('#'), false);
  assert.equal(paths.page(PAGE, 'A', null).includes('#'), false);
  assert.equal(blockFromHash('#something-else'), null);
  assert.equal(blockFromHash(''), null);
});

test('a search result lands on the block, and the page waits for it', () => {
  // The block is not in the DOM when the page mounts: the document arrives over
  // the sync connection a moment later. A link that works on a fast connection
  // and silently does nothing on a slow one is worse than no link.
  const search = codeOf(new URL('../src/components/Search.tsx', import.meta.url));
  assert.match(search, /paths\.page\(result\.pageId, result\.title, result\.blockId\)/);

  const page = codeOf(new URL('../src/components/PageView.tsx', import.meta.url));
  assert.match(page, /blockFromHash\(window\.location\.hash\)/);
  assert.match(page, /attempts > 20/, 'gives up rather than retrying forever');
});

test('a suggestion is drawn apart from the results it is not one of', () => {
  // Two ranking systems in one ordered list cannot be reasoned about: a row is
  // either above another because it matched better or because a different
  // measure said so, and nobody can tell which by looking (ADR-0036).
  const search = codeOf(new URL('../src/components/Search.tsx', import.meta.url));
  assert.match(search, /results\.length === 0 \? 'Did you mean' : 'Similar names'/);
  assert.match(search, /\{similar\.length > 0 && \(/);
  // And it is not passed to the group component that draws ranked results.
  assert.doesNotMatch(search, /<Group[^>]*results=\{similar/);
});
