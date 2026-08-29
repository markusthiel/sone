/**
 * An attached file in the text.
 *
 * Three ways to draw one block. The decisions worth holding are about what is
 * *not* offered: a viewer for a file nothing can render is a promise that
 * cannot be kept.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(
  new URL('../src/components/FileNodeView.ts', import.meta.url),
  'utf8',
);

test('a viewer is offered only for what a browser can draw', () => {
  // A viewer button on a spreadsheet is a promise nothing here can keep. The
  // predicate mirrors the server's own answer rather than being a second list
  // that would drift from it.
  assert.match(source, /const viewable = \(category: unknown\): boolean =>/);
  assert.match(source, /if \(viewable\(category\)\) options\.push\(\{ id: 'full'/);
});

test('an unrenderable file falls back to a card even if it says otherwise', () => {
  // A stored display of 'full' on a spreadsheet — set before a type changed,
  // or written by another client — would otherwise draw an empty frame for
  // ever.
  assert.match(source, /display === 'full' && viewable\(category\)/);
});

test('a file with no id is drawn, not left blank', () => {
  // An upload in flight or one that failed. A block rendering as nothing looks
  // like content somebody lost, which is the same reason the image block draws
  // its pending state.
  assert.match(source, /state'\] = 'pending'/);
  assert.match(source, /Uploading \$\{String\(filename \|\| 'file'\)\}/);
});

test('the viewer frame is sandboxed from the embedding side too', () => {
  // The server sends a sandbox policy with the file; this states the same
  // restriction where it is embedded, so the header and the attribute have to
  // agree before anything runs.
  assert.match(source, /setAttribute\('sandbox',/);
});

test('the display buttons act on click', () => {
  // pointerdown fires before a finger lifts and cancels the scroll gesture with
  // it — the cause of every touch bug this project has had.
  assert.match(source, /addEventListener\('click'/);
  assert.doesNotMatch(source, /addEventListener\('pointerdown'/);
});

test('a size is shown coarsely, and nonsense shows nothing', () => {
  // Nobody needs the byte count, and "NaN B" beside a filename is worse than
  // no size at all.
  assert.match(source, /Number\.isFinite\(bytes\)/);
});

test('the document picker is separate from the image one', () => {
  // One input with a wider accept list would have to guess which block to
  // insert from the file's type — exactly the guess the server refuses to make
  // from a declared type.
  const surface = readFileSync(
    new URL('../src/components/EditorSurface.tsx', import.meta.url),
    'utf8',
  );
  assert.match(surface, /docInputRef/);
  assert.match(surface, /fileInputRef/);
  const uploadAt = surface.indexOf('await api.uploadFile(pageId, file)');
  const insertAt = surface.indexOf('insertFileBlock({');
  assert.ok(uploadAt > 0 && insertAt > uploadAt, 'the upload comes first');
});

test('a PDF frame is allowed scripts, and never same-origin', () => {
  // Without scripts the browser's viewer renders page one and nothing reaches
  // page two. With allow-same-origin, script inside a document somebody
  // uploaded could read this application's cookies and storage — so the one
  // that must never appear is that, not scripts.
  assert.match(source, /category === 'pdf' \? 'allow-scripts' : ''/);

  // Checked against the code rather than the file: a first version scanned the
  // whole source and failed on the comment that explains why allow-same-origin
  // is absent. A test that cannot tell prose from code will eventually be
  // silenced by rewording rather than by fixing anything.
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(withoutComments, /allow-same-origin/);
});
