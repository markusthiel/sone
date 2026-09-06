/**
 * Who wrote this page, as opposed to who opened it (ADR-0116).
 *
 * Reported as the People panel being inconsistent — empty on some pages, one
 * name on others, two on others again. It was consistent; it was answering a
 * different question than its heading.
 *
 * `recordAttribution` runs when a document **opens**, and it has to: attribution
 * is not retroactive, so the mapping must be in place before the first
 * keystroke rather than after it. The mapping is therefore "everyone who has
 * had this page open" — the set of people who *might* have written — and
 * reading it as the answer lists a colleague who glanced at the page beside the
 * person who wrote it.
 *
 * The document already holds the other half. `liveClientIds` says which client
 * ids still have content, and pruning has used it since ADR-0022 for exactly
 * this rule: an entry may go when nothing of that person's writing is left.
 * `writersIn` is that rule applied at the moment of asking rather than whenever
 * a server-side mutation happens to run.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as Y from 'yjs';

import { DOC_KEYS } from '../src/doc/docSchema.js';
import { USERS_KEY, hasUnattributedWriting, writersIn } from '../src/doc/attribution.js';

const ANNA = '11111111-1111-4111-8111-111111111111';
const BO = '22222222-2222-4222-8222-222222222222';

/** Put a client id in the mapping the way `recordAttribution` does. */
function record(doc: Y.Doc, userKey: string, clientId = doc.clientID): void {
  const users = doc.getMap(USERS_KEY);
  const existing = users.get(userKey);
  const entry = existing instanceof Y.Map ? existing : new Y.Map();
  if (!(existing instanceof Y.Map)) users.set(userKey, entry);
  const ids = entry.get('ids');
  const list: Y.Array<number> = ids instanceof Y.Array ? ids : new Y.Array<number>();
  // Set through the widened map, because a fresh `Y.Map` has no value type yet
  // and the union of its two `set` signatures is not callable.
  if (!(ids instanceof Y.Array)) (entry as Y.Map<unknown>).set('ids', list);
  list.push([clientId]);
}

/** A session that opens the page, as `open()` does, and may then write. */
function session(userKey: string): Y.Doc {
  const doc = new Y.Doc();
  record(doc, userKey);
  return doc;
}

/** Everything both docs know. */
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
}

describe('who wrote this page', () => {
  test('somebody who only opened it is not a writer', () => {
    // The report, in one assertion. Anna types; Bo opens the page and reads.
    // The mapping lists both, because it must — Bo could have typed.
    const anna = session(ANNA);
    anna.getXmlFragment(DOC_KEYS.content).insert(0, [new Y.XmlText('etwas')]);
    const bo = session(BO);
    sync(anna, bo);

    assert.deepEqual([...writersIn(anna).keys()], [ANNA]);
    assert.equal(
      anna.getMap(USERS_KEY).size,
      2,
      'and the mapping still holds both, which is what makes it not the answer',
    );
  });

  test('and neither is somebody whose writing has gone', () => {
    /*
     * The same rule pruning has used since ADR-0022: deleted text should not
     * keep a name in the record. Asked at the moment of reading rather than
     * whenever a server-side mutation happens to run — which is why two pages
     * with identical histories could list different people.
     */
    const anna = session(ANNA);
    const body = anna.getXmlFragment(DOC_KEYS.content);
    body.insert(0, [new Y.XmlText('etwas')]);
    assert.deepEqual([...writersIn(anna).keys()], [ANNA]);

    body.delete(0, 1);
    assert.deepEqual([...writersIn(anna).keys()], []);
  });

  test('a writer keeps the client ids their writing is under', () => {
    // The panel marks somebody's writing in the editor, and what it marks with
    // is the ids. A filtered list that dropped them would be a name nobody can
    // click.
    const anna = session(ANNA);
    anna.getXmlFragment(DOC_KEYS.content).insert(0, [new Y.XmlText('etwas')]);

    assert.deepEqual(writersIn(anna).get(ANNA), [anna.clientID]);
  });

  test('a second session of the same person is one writer', () => {
    // Two ids, one name: opening the page on a phone does not make somebody two
    // contributors.
    const laptop = session(ANNA);
    laptop.getXmlFragment(DOC_KEYS.content).insert(0, [new Y.XmlText('am Rechner')]);
    const phone = new Y.Doc();
    Y.applyUpdate(phone, Y.encodeStateAsUpdate(laptop));
    record(phone, ANNA);
    phone.getXmlFragment(DOC_KEYS.content).insert(1, [new Y.XmlText('unterwegs')]);
    sync(laptop, phone);

    const writers = writersIn(laptop);
    assert.deepEqual([...writers.keys()], [ANNA]);
    assert.equal(writers.get(ANNA)?.length, 2, 'both sessions, under one name');
  });
});

describe('somebody the document cannot name', () => {
  test('a guest who wrote is reported', () => {
    // A share-link visitor with no name is deliberately not recorded, and
    // saying nothing about them was the mistake ADR-0022 corrected: a page a
    // guest had visibly written on looked like a page nobody had written on.
    const anna = session(ANNA);
    const stranger = new Y.Doc();
    Y.applyUpdate(stranger, Y.encodeStateAsUpdate(anna));
    stranger.getXmlFragment(DOC_KEYS.content).insert(0, [new Y.XmlText('von wem?')]);
    sync(anna, stranger);

    assert.equal(hasUnattributedWriting(anna), true);
  });

  test('and a rename by the server is not somebody', () => {
    /*
     * **The finding.** `applyToDocument` loads its own `Y.Doc` with its own
     * client id, so a rename, a move, an icon, a lock, an import or a comment
     * posted over HTTP is live content from a client the mapping has never
     * heard of.
     *
     * So the note fired on very nearly every page — it takes one rename — and
     * named two causes, neither of which was the usual one. A note that is
     * always there says nothing, and this one sat above a list it was
     * contradicting.
     */
    const anna = session(ANNA);
    anna.getXmlFragment(DOC_KEYS.content).insert(0, [new Y.XmlText('etwas')]);

    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(anna));
    server.getMap(DOC_KEYS.page).set('title', 'Umbenannt');
    Y.applyUpdate(anna, Y.encodeStateAsUpdate(server, Y.encodeStateVector(anna)));

    assert.equal(hasUnattributedWriting(anna), false, 'a route setting a title is not a person');
    assert.deepEqual([...writersIn(anna).keys()], [ANNA], 'and it adds nobody to the list');
  });

  test('but writing in the body still counts, whoever put it there', () => {
    // The counterweight: the exemption is for the structural roots a route
    // writes, not for anything a server happens to do. An import writes blocks,
    // and blocks are somebody's words.
    const anna = session(ANNA);
    const importer = new Y.Doc();
    Y.applyUpdate(importer, Y.encodeStateAsUpdate(anna));
    importer.getXmlFragment(DOC_KEYS.content).insert(0, [new Y.XmlText('importiert')]);
    Y.applyUpdate(anna, Y.encodeStateAsUpdate(importer, Y.encodeStateVector(anna)));

    assert.equal(hasUnattributedWriting(anna), true);
  });

  test('a page nobody has written on says nothing at all', () => {
    const empty = new Y.Doc();
    empty.getMap(DOC_KEYS.page).set('title', 'Neu');

    assert.equal(hasUnattributedWriting(empty), false);
    assert.deepEqual([...writersIn(empty).keys()], []);
  });
});
