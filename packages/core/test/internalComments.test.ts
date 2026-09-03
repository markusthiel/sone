/**
 * Where internal comments live (ADR-0057).
 *
 * The derived id has to be a real uuid and the same every time — Postgres
 * refuses anything else as a uuid, and two processes computing different ids
 * would each write half a conversation.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  asInternalRequest,
  internalDocId,
  readInternalRequest,
} from '../src/doc/comments.js';

const sha1 = (data: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha1').update(data).digest());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('the derived id is a version 5 uuid, and the same every time', () => {
  const page = '00000000-0000-4000-8000-000000000001';
  const first = internalDocId(page, sha1);
  assert.match(first, UUID, 'a uuid with the version and variant bits set');
  assert.equal(internalDocId(page, sha1), first, 'deterministic');
});

test('two pages get two documents', () => {
  const a = internalDocId('00000000-0000-4000-8000-000000000001', sha1);
  const b = internalDocId('00000000-0000-4000-8000-000000000002', sha1);
  assert.notEqual(a, b);
});

test('the internal document is never the page´s own', () => {
  // It is stored in the same table, keyed by an opaque id — so a collision
  // would mean internal comments written into the page everybody can read.
  const page = '00000000-0000-4000-8000-000000000001';
  assert.notEqual(internalDocId(page, sha1), page);
});

test('asking for the internal document needs no new message', () => {
  // A suffix on the page id rather than a field in the open message: a new
  // field would change the wire shape and cost a protocol version for one bit.
  const page = '00000000-0000-4000-8000-000000000001';
  assert.deepEqual(readInternalRequest(asInternalRequest(page)), {
    pageId: page,
    internal: true,
  });
  assert.deepEqual(readInternalRequest(page), { pageId: page, internal: false });
});
