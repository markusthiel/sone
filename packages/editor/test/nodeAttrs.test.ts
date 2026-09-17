/**
 * Core's table of node attributes is the schema's (ADR-0191).
 *
 * `BLOCK_NODE_ATTRS` tells a writer without ProseMirror — the importer — which
 * of a block's properties are node attributes rather than props keys. It is a
 * copy of something the schema knows, and a copy drifts; this holds them
 * together so that adding an attribute to a node without listing it here is a
 * failing test rather than an import that quietly loses it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS, BLOCK_NODE_ATTRS, SHARED_NODE_ATTRS } from '@sone/core';

import { schema } from '../src/schema.js';

test('every block node’s own attributes are listed, and nothing else is', () => {
  const shared = new Set<string>([BLOCK_ATTRS.id, BLOCK_ATTRS.props, BLOCK_ATTRS.indent, ...SHARED_NODE_ATTRS]);
  const fromSchema: Record<string, string[]> = {};
  for (const [name, type] of Object.entries(schema.nodes)) {
    if (!type.spec.group?.includes('block')) continue;
    fromSchema[name] = Object.keys(type.spec.attrs ?? {}).filter((key) => !shared.has(key)).sort();
  }
  const fromCore: Record<string, string[]> = {};
  for (const [name, keys] of Object.entries(BLOCK_NODE_ATTRS)) fromCore[name] = [...keys].sort();
  assert.deepEqual(fromCore, fromSchema);
});

test('the shared presentation attributes are the ones every block carries', () => {
  for (const type of Object.values(schema.nodes)) {
    if (!type.spec.group?.includes('block')) continue;
    for (const key of SHARED_NODE_ATTRS) {
      assert.ok(type.spec.attrs?.[key], `${type.name} has ${key}`);
    }
  }
});
