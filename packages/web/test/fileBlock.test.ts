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

import { codeOf } from './helpers/source.ts';

const source = codeOf(new URL('../src/components/FileNodeView.ts', import.meta.url));

test('a viewer is offered only for what a browser can draw', () => {
  // A viewer button on a spreadsheet is a promise nothing here can keep. The
  // offering moved to the gutter menu with the rest of the file's actions; the
  // block still refuses to draw a viewer it cannot fill.
  assert.match(source, /const viewable = \(category: unknown\): boolean =>/);

  const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));
  // An image is excluded on top of that: it has "Image", and a picture behind a
  // scrollbar is worse than the picture.
  assert.match(menu, /if \(viewable && category !== 'image'\) options\.push\(\{ id: 'full'/);
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

test('everything but a PDF is sandboxed from the embedding side too', () => {
  // The server sends a sandbox policy with those files; this states the same
  // restriction where they are embedded, so the header and the attribute have
  // to agree before anything runs.
  assert.match(source, /if \(category !== 'pdf'\) frame\.setAttribute\('sandbox', ''\)/);
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

test('a PDF frame is not sandboxed at all', () => {
  // Two attempts said otherwise. `sandbox` rendered page one and no further;
  // `sandbox allow-scripts` made Chromium browsers refuse to render anything.
  // The built-in viewer is a browser component rather than page script and does
  // not run in a sandboxed frame whatever tokens are set, so the safety comes
  // from the response instead — the type is decided from the bytes, `nosniff`
  // stops the browser reconsidering, and the file may load nothing.
  //
  // Checked against the code rather than the file: an earlier version of this
  // test scanned the whole source and matched the comment explaining the
  // reasoning. A test that cannot tell prose from code will eventually be
  // silenced by rewording rather than by fixing anything.
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(withoutComments, /allow-same-origin/);
  assert.doesNotMatch(withoutComments, /'allow-scripts'/);
});

test('the name opens what a browser can draw, and downloads what it cannot', () => {
  // It always downloaded, which is nearly always wrong for a PDF sitting in the
  // page as a viewer: whoever clicks its name has it open already and wants it
  // bigger, not a copy in their downloads folder.
  assert.match(source, /if \(viewable\(category\)\) \{[\s\S]{0,160}link\.target = '_blank'/);
  assert.match(source, /\} else \{[\s\S]{0,120}setAttribute\('download', name\)/);
});

test('a tab opened from here cannot reach back into the page', () => {
  assert.match(source, /rel = 'noopener noreferrer'/);
});





// --- dropping files ---------------------------------------------------------

const surfaceCode = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));

test('a drop lands where it was dropped', () => {
  // Every insert here works on the selection, so without moving the caret a
  // file dropped at the end of a long page lands wherever the caret happened to
  // be — usually somewhere the person cannot see.
  assert.match(surfaceCode, /posAtCoords\(at\)/);
  assert.match(surfaceCode, /TextSelection\.near\(/);
});

test('dragover is prevented, or the browser navigates away', () => {
  // Without it the drop never reaches the page: the browser opens the file
  // instead, losing whatever was being written.
  assert.match(surfaceCode, /onDragOver=\{\(event\) => \{/);
  assert.match(surfaceCode, /types\.includes\('Files'\)/);
});

test('several files keep the order they were dropped in', () => {
  // Parallel uploads finish in whatever order the network decides, and five
  // files should produce five blocks in the order somebody chose them.
  assert.match(surfaceCode, /for \(const file of files\)/);
  assert.match(surfaceCode, /else await attachFile\(file\)/);
});

test('an image stays an image however it arrives', () => {
  // Same block, same preview while it uploads. Only what cannot be an image
  // becomes a file block.
  assert.match(surfaceCode, /file\.type\.startsWith\('image\/'\)/);
});

test('a reader cannot drop into a page they may not edit', () => {
  assert.match(surfaceCode, /!canEditRef\.current/);
});


test('the block has no menu of its own', () => {
  // Changing how a file is shown lives in the gutter menu with every other
  // block's settings. The `···` button here was a second place to ask the same
  // kind of question, and the gutter is where somebody already looks.
  //
  // Narrowed from "no click listener at all", which was too broad: the block
  // needs one to select itself so the gutter can appear on a touch device. A
  // test that forbids a mechanism rather than a behaviour blocks the fix as
  // readily as the mistake.
  assert.doesNotMatch(source, /file-menu/);
  assert.doesNotMatch(source, /Show as/);
});

test('the gutter menu carries the file actions instead', () => {
  const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));
  assert.match(menu, /range\.node\.type\.name === 'file'/);
  // By key: the menu is translated (ADR-0041).
  assert.match(menu, /t\('block\.openInNewTab'\)/);
  assert.match(menu, /t\('block\.download'\)/);
  assert.match(menu, /setFileDisplay\(at,/);
});

test('a tap selects the block, so the gutter can appear', () => {
  // The gutter shows for the selected block, there is no hover on a touch
  // device to fall back on, and stopEvent keeps every event from reaching
  // ProseMirror — so tapping a file did nothing and the handle never came.
  assert.match(source, /NodeSelection\.create\(view\.state\.doc, pos\)/);
});

test('a tap on a link or a control is left alone', () => {
  // Those have their own job, and selecting the block as well would fight them.
  assert.match(source, /target\?\.closest\('a, button, iframe'\)/);
});

// --- an image as a card or a link -------------------------------------------

test('an image is offered the file layouts, by becoming a file', () => {
  // The card and the link are the file block's own. Reached by converting the
  // block rather than by teaching a second component the same layouts — which
  // is the duplication the `···` menu was removed to undo.
  const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));
  assert.match(menu, /showImageAs\(at, choice\.id\)/);
  assert.match(menu, /label: 'block\.display\.image'/);
});

test('an image is never offered a viewer frame', () => {
  // A picture behind a scrollbar is worse than the picture. It has "Image"
  // instead.
  const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));
  assert.match(menu, /viewable && category !== 'image'/);
});
