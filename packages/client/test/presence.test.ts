/**
 * Presence, and the copy the editor reads.
 *
 * SONE calls these `displayName` and `color`; y-prosemirror insists on
 * `user.name` and `user.color`, and replaces a colour that is not six-digit hex
 * with its own orange. So a copy is published alongside — and the two must not
 * drift, which is exactly what happened: a plain merge in setPresence updated
 * `displayName` and left `user` behind, so somebody who supplied their name
 * after connecting appeared correctly in the avatar list and as "Someone"
 * beside their own caret.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';

import { withEditorUser } from '../src/store.js';

test('the editor copy carries the name and colour', () => {
  const state = withEditorUser({ displayName: 'Markus', color: '#12a594' });
  assert.deepEqual(state['user'], { name: 'Markus', color: '#12a594' });
});

test('a missing name is a person, not an empty label', () => {
  for (const presence of [{}, { displayName: '' }]) {
    assert.deepEqual((withEditorUser(presence)['user'] as { name: string }).name, 'Someone');
  }
});

test('a colour y-prosemirror would reject is replaced here, not there', () => {
  // It substitutes its own orange for anything that is not six-digit hex, which
  // is how every caret ended up the same colour. Better a grey we chose than a
  // colour we did not.
  for (const color of [undefined, '', 'red', 'hsl(200 50% 50%)', '#abc']) {
    const user = withEditorUser({ displayName: 'A', ...(color === undefined ? {} : { color }) })[
      'user'
    ] as { color: string };
    assert.match(user.color, /^#[0-9a-f]{6}$/i, String(color));
  }
});

test('the original fields are kept alongside the copy', () => {
  // The rest of the application reads displayName; only the editor reads user.
  const state = withEditorUser({ displayName: 'Markus', color: '#12a594', userId: 'u1' });
  assert.equal(state['displayName'], 'Markus');
  assert.equal(state['userId'], 'u1');
});

test('updating a name updates the copy with it', () => {
  // The bug: two fields describing one thing, updated in one place only.
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);

  awareness.setLocalState(withEditorUser({ displayName: 'Someone', color: '#12a594' }));
  awareness.setLocalState(
    withEditorUser({
      ...(awareness.getLocalState() ?? {}),
      displayName: 'Markus',
    }),
  );

  const local = awareness.getLocalState() as Record<string, unknown>;
  assert.equal(local['displayName'], 'Markus');
  assert.deepEqual((local['user'] as { name: string }).name, 'Markus', 'and the copy');

  awareness.destroy();
  doc.destroy();
});
