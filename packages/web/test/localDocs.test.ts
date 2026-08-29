/**
 * Keeping documents locally.
 *
 * Edits already survived a lost connection — the CRDT holds them in memory —
 * but not a reload, which is the case that actually happens. These cover the
 * two decisions that are not about syncing at all: who gets a copy, and when it
 * goes away.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const source = (name: string): string => codeOf(new URL(`../src/${name}`, import.meta.url));

test('a share-link guest gets no local copy', () => {
  // Somebody arriving through a link is often on a borrowed or shared machine,
  // and leaving another person's document in that browser is a disclosure they
  // never agreed to: the link gave them a page to read, not one to keep.
  const hook = source('hooks/useSoneClient.ts');
  assert.match(hook, /credentials\.shareToken \? \{\} : \{ persist: persistLocally \}/);
});

test('signing out deletes the local copies', () => {
  // Otherwise the next person at that machine finds them in storage, readable
  // without any credential at all.
  const session = source('hooks/useSession.ts');
  assert.match(session, /await clearLocalDocs\(\)/);
  const clearAt = session.indexOf('clearLocalDocs');
  const reloadAt = session.indexOf('await reload()', clearAt);
  assert.ok(reloadAt > clearAt, 'and before the session is reloaded');
});

test('local copies are swept, so they cannot grow without bound', () => {
  const main = source('main.tsx');
  assert.match(main, /sweepLocalDocs\(\)/);

  const docs = source('storage/localDocs.ts');
  assert.match(docs, /MAX_AGE_DAYS = 30/);
  assert.match(docs, /deleteDatabase/);
});

test('destroying a copy closes it rather than deleting it', () => {
  // `clearData` would delete the stored document, which is the opposite of the
  // point: leaving a page must not throw away what was written offline.
  const docs = source('storage/localDocs.ts');
  assert.doesNotMatch(docs, /provider\.clearData\(\)/);
  assert.match(docs, /provider\.destroy\(\)/);
});

test('storage that refuses is not fatal', () => {
  // Private browsing, a full quota, a browser that reports IndexedDB and then
  // declines to open one. The document still syncs; only the local copy is
  // missing.
  const docs = source('storage/localDocs.ts');
  assert.match(docs, /return null;/);
  assert.match(docs, /localStorageAvailable/);
});

test('the index ignores values that are not times', () => {
  // A non-number would make the sweep compare against NaN and keep everything
  // for ever — a bound that silently stops bounding.
  const docs = source('storage/localDocs.ts');
  assert.match(docs, /typeof value === 'number'/);
});
