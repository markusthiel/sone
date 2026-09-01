/**
 * That a person's edits are actually attributed (ADR-0022).
 *
 * The module was right and nothing used it: the web client passed `userId: null`
 * into presence, so `recordAttribution` returned early and no mapping was ever
 * written. The people panel was empty on every page since the day it was built,
 * and no test noticed because every test of attribution called the function
 * directly with an id.
 *
 * So this one goes the other way round: it asserts the *wiring*.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as Y from 'yjs';

import { attributionUsers, recordAttribution } from '../src/attribution.js';

test('a document with a user id records one, and without one records nothing', () => {
  const withUser = new Y.Doc();
  recordAttribution(withUser, { userId: 'u-1', enabled: true });
  assert.deepEqual([...attributionUsers(withUser).keys()], ['u-1']);

  // A share-link guest has no id to record against, and one contributor that is
  // really several people is worse than saying nothing.
  const guest = new Y.Doc();
  recordAttribution(guest, { userId: null, enabled: true });
  assert.deepEqual([...attributionUsers(guest).keys()], []);
});

test('the web client passes a real user id, not null', () => {
  // The assertion that was missing. `userId: null` type-checks, reads as
  // deliberate, and switches the whole feature off.
  const hook = readFileSync(
    new URL('../../web/src/hooks/useSoneClient.ts', import.meta.url),
    'utf8',
  );
  assert.match(hook, /userId: credentials\.userId \?\? null/);
  assert.doesNotMatch(hook, /^\s*userId: null,$/m);

  const app = readFileSync(new URL('../../web/src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /userId: session\.user\.id/);

  // And the client is rebuilt when the person changes, or signing in as somebody
  // else would keep attributing to the first.
  assert.match(hook, /credentials\.userId \?\? ''/);
});

test('writing nobody can be named is reported rather than left silent', async () => {
  // A share-link guest is deliberately not recorded, and until now that was a
  // silence: a page a guest had visibly written on looked like a page nobody had
  // written on, which reads as a broken panel rather than a deliberate choice.
  const { hasUnattributedWriting } = await import('../src/attribution.js');

  const doc = new Y.Doc();
  recordAttribution(doc, { userId: 'u-1', enabled: true });
  doc.getText('body').insert(0, 'Mine');
  assert.equal(hasUnattributedWriting(doc), false, 'everything here has a name');

  // A second session with no user id — a guest — writing into the same document.
  const guest = new Y.Doc();
  Y.applyUpdate(guest, Y.encodeStateAsUpdate(doc));
  recordAttribution(guest, { userId: null, enabled: true });
  guest.getText('body').insert(0, 'Theirs. ');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(guest));

  assert.equal(hasUnattributedWriting(doc), true);
});
