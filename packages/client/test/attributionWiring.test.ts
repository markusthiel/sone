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

test('a guest is recorded under the name they gave', async () => {
  // A share link asks for a name before letting anybody in, and that name is the
  // identity they chose for this page. Refusing to use it threw away the only
  // thing they had told us and then reported that nobody had written.
  const { guestKey, guestName, isGuestKey } = await import('../src/attribution.js');

  const doc = new Y.Doc();
  recordAttribution(doc, { userId: null, guestName: 'Anna', enabled: true });
  assert.deepEqual([...attributionUsers(doc).keys()], [guestKey('Anna')]);

  // Prefixed, and the prefix is the point: a guest called "Markus Thiel" must
  // not be indistinguishable from the account of that name.
  assert.ok(isGuestKey(guestKey('Markus Thiel')));
  assert.equal(guestName(guestKey('Anna')), 'Anna');

  // A session with no identity at all is still not recorded.
  const nameless = new Y.Doc();
  recordAttribution(nameless, { userId: null, guestName: null, enabled: true });
  assert.deepEqual([...attributionUsers(nameless).keys()], []);
});

test('the client passes a guest name only for a guest', async () => {
  // A member has an account; sending their display name as a guest name would
  // list them twice, once as themselves and once as a guest of the same name.
  const store = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8');
  assert.match(store, /guestName: this\.opts\.presence\?\.isAnonymous/);
});

test('a reader is never recorded, even though the document opens for them', () => {
  // The mapping is written when the document opens rather than when somebody
  // first types, so an empty name is the only thing keeping a reader out of the
  // list — and a read-only link never asks for one.
  const store = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8');
  // Written across two lines by the formatter, so this reads it as one.
  assert.match(store, /guestName: this\.opts\.presence\?\.isAnonymous[\s\S]{0,80}presence\?\.guestName \?\? null/);
  // Not the presence label, which falls back to something so a cursor has a
  // name: a reader would then appear as "Someone", having written nothing.
  assert.doesNotMatch(store, /guestName: this\.opts\.presence\?\.displayName/);

  const hook = readFileSync(
    new URL('../../web/src/hooks/useSoneClient.ts', import.meta.url),
    'utf8',
  );
  assert.match(hook, /guestName: credentials\.displayName \?\? null/);
});
