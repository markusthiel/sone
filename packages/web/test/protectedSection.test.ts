/**
 * A protected section in a page.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const view = codeOf(new URL('../src/components/ProtectedSectionView.ts', import.meta.url));
const surface = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));

test('the block holds an id and no content', () => {
  // What is inside is a separate document the server serves only to people who
  // may read it. Content here would be content in everybody's browser
  // (ADR-0026).
  assert.match(view, /containerId/);
  assert.doesNotMatch(view, /innerHTML/);
});

test('a section is created before the block that refers to it', () => {
  // There is no id until the server has made the document, and a block pointing
  // at a container that failed to be created is a locked door with nothing
  // behind it.
  const created = surface.indexOf('api.createContainer(pageId)');
  const inserted = surface.indexOf("schema.nodes['protectedSection']");
  assert.ok(created > 0 && created < inserted);
});

test('a failed creation inserts nothing', () => {
  assert.match(surface, /const created = await api\.createContainer\(pageId\);[\s\S]{0,400}?catch/);
});

test('the interface knows the slash item, or the editor test fails', () => {
  // The editor names the external ids it expects the interface to handle, and
  // adding one without teaching SlashMenu.tsx about it fails there rather than
  // producing a menu entry that silently does nothing. This is the other half.
  const menu = codeOf(new URL('../src/components/SlashMenu.tsx', import.meta.url));
  assert.match(menu, /item\.id === 'protected'/);
});

test('the block says plainly that it is closed', () => {
  // The alternative is somebody assuming it is a rendering fault and reloading
  // the page to fix it.
  assert.match(view, /Only people you add can open this/);
});

test('nothing inside the block reaches this document', () => {
  // What happens in there belongs to another document, and letting a click
  // through would move this document's selection for a reason nobody could see.
  assert.match(view, /stopEvent\(\): boolean \{\s*return true;/);
});
