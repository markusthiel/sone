/**
 * Deciding how large a web version should be.
 *
 * The arithmetic is tested and the drawing is not: a canvas needs a browser,
 * and the part that goes wrong quietly is the sizing — an off-by-one there is a
 * picture one pixel narrower every time somebody touches it (ADR-0029).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

import { AVATAR_BOUND, WEB_BOUND, canResize, webVariantSize } from '../src/lib/imageVariant.ts';

test('an image within the bound gets no variant', () => {
  // Producing a "web version" the same size as the original is two files where
  // one would do, and a download menu offering two identical files makes
  // somebody choose between nothing.
  assert.equal(webVariantSize({ width: 1200, height: 800 }), null);
  assert.equal(webVariantSize({ width: WEB_BOUND, height: 100 }), null, 'exactly at the bound');
});

test('a large image is bounded on its long edge', () => {
  assert.deepEqual(webVariantSize({ width: 4096, height: 3072 }), {
    width: 2048,
    height: 1536,
  });
  assert.deepEqual(webVariantSize({ width: 3072, height: 4096 }), {
    width: 1536,
    height: 2048,
  }, 'portrait too');
});

test('the aspect ratio survives', () => {
  // The failure this catches is a picture that is subtly stretched, which
  // people see without being able to name.
  const before = { width: 5000, height: 2000 };
  const after = webVariantSize(before)!;
  assert.ok(Math.abs(before.width / before.height - after.width / after.height) < 0.01);
});

test('a sliver of an image does not become nothing', () => {
  // A panorama 8000 by 3 pixels is absurd and still somebody's file. A height
  // of zero is a canvas that throws.
  const size = webVariantSize({ width: 8000, height: 3 })!;
  assert.equal(size.width, 2048);
  assert.ok(size.height >= 1);
});

test('an empty size is refused rather than divided by', () => {
  assert.equal(webVariantSize({ width: 0, height: 0 }), null);
});

test('an avatar is bounded harder', () => {
  // It is drawn at 22 pixels. Keeping a face at full resolution because the
  // code path was already there is not a decision anybody made.
  assert.deepEqual(webVariantSize({ width: 2000, height: 2000 }, AVATAR_BOUND), {
    width: 512,
    height: 512,
  });
});

test('only formats a browser will decode are attempted', () => {
  // A HEIC from a phone, a TIFF, a PDF: the upload still happens, just without
  // a variant — which is the same as a client that cannot resize at all, so it
  // is a path the server already supports.
  assert.equal(canResize('image/jpeg'), true);
  assert.equal(canResize('image/png'), true);
  assert.equal(canResize('image/heic'), false);
  assert.equal(canResize('application/pdf'), false);
});

// --- uploading the pair, and offering the choice ----------------------------

const surface = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));
const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));

test('the original is uploaded first and its failure is the only fatal one', () => {
  // It is the file the block refers to. A page that shows the original is the
  // behaviour SONE had yesterday; losing an upload because the second half did
  // not work would be a worse trade than sending a few megabytes.
  const original = surface.indexOf('await api.uploadFile(pageId, file)');
  const variant = surface.indexOf('webVariant(file)');
  assert.ok(original > 0 && original < variant);
  assert.match(surface, /webVariant\(file\)[\s\S]{0,300}?\.catch\(\(\) => null\)/);
});

test('the variant is linked to the file it was made from', () => {
  assert.match(surface, /api\.uploadFile\(pageId, smaller, result\.id\)/);
});

test('the original is offered only for images', () => {
  // Nothing else has a second version, and an entry that gives the same file
  // twice under two names is a menu that asks somebody to choose between
  // nothing.
  assert.match(menu, /category === 'image' && \(/);
  assert.match(menu, /\?original=true/);
});
