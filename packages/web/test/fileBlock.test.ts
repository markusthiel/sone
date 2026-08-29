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

test('everything but a PDF is sandboxed from the embedding side too', () => {
  // The server sends a sandbox policy with those files; this states the same
  // restriction where they are embedded, so the header and the attribute have
  // to agree before anything runs.
  assert.match(source, /if \(category !== 'pdf'\) frame\.setAttribute\('sandbox', ''\)/);
});

test('the menu acts on click', () => {
  // pointerdown fires before a finger lifts and cancels the scroll gesture with
  // it — the cause of every touch bug this project has had.
  assert.match(source, /addEventListener\('click'/);
  assert.doesNotMatch(source, /addEventListener\('pointerdown'/);
});

test('the menu closes when attention moves elsewhere', () => {
  // Otherwise the menu of a file scrolled off screen stays open behind the
  // page.
  assert.match(source, /focusout/);
});

test('"open" is offered only for what a browser can draw', () => {
  // "Open" on a spreadsheet opens a download, which is what the item below it
  // already says plainly — two items doing the same thing under different
  // names.
  const menu = source.slice(source.indexOf("heading('Do')"));
  assert.match(menu.slice(0, 700), /if \(viewable\(category\)\)/);
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

test('downloading is always offered, whatever the file is', () => {
  // It is the one thing that works for every type, so it is never behind a
  // condition.
  assert.match(source, /download\.textContent = 'Download'/);
});

test('the menu closes when a click lands elsewhere', () => {
  // focusout alone left it open for good: Safari does not focus a button when
  // it is clicked, so focus never entered the menu and never left it. A
  // document listener is what actually observes "somebody is doing something
  // else now".
  assert.match(source, /document\.addEventListener\('click', onOutside, true\)/);
  assert.match(source, /document\.removeEventListener\('click', onOutside, true\)/);
});

test('the listener does not outlive its element', () => {
  // render() throws the menu away on every update, and ProseMirror throws the
  // whole view away when the block goes. A listener left on the document would
  // then be closing a menu that no longer exists.
  assert.match(source, /destroy\(\): void \{\s*this\.closeMenu\?\.\(\);/);
  assert.match(source, /this\.closeMenu\?\.\(\);\s*this\.render\(\)/);
});

test('only one file menu is open at a time', () => {
  assert.match(source, /if \(this\.closeMenu && this\.closeMenu !== close\) this\.closeMenu\(\)/);
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

test('the menu sits inside the card, not below it', () => {
  // Appended after the card it rendered underneath: a loose button below a
  // tile, belonging to nothing visible. The line display had it in the row all
  // along, and the card now uses the same arrangement.
  assert.match(source, /head\.append\(this\.link\(url, name, category\), this\.controls\(/);
  assert.match(source, /card\.append\(head, meta\)/);
  assert.doesNotMatch(source, /this\.dom\.append\(card, this\.controls\(/);
});
