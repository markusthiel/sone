/**
 * The video block's drawing (ADR-0037).
 *
 * The property that matters most cannot be seen by rendering once: an embedded
 * video must make no request to its provider until somebody presses play. So
 * these read the node view, and what they check is the absence of things.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const view = codeOf(new URL('../src/components/VideoNodeView.ts', import.meta.url));
const schema = codeOf(new URL('../../editor/src/schema.ts', import.meta.url));
const css = codeOf(new URL('../src/styles.css', import.meta.url));

test('nothing reaches a provider before the play control is pressed', () => {
  // This is self-hosted software: opening a page must not be how YouTube learns
  // somebody read it. The frame is created inside the click handler and nowhere
  // else — and there is no thumbnail either, because a provider's thumbnail comes
  // from the provider.
  const inClick = view.slice(view.indexOf("gate.addEventListener('click'"));
  assert.match(inClick, /createElement\('iframe'\)/, 'the frame is made in the handler');

  const beforeClick = view.slice(0, view.indexOf("gate.addEventListener('click'"));
  assert.doesNotMatch(beforeClick, /createElement\('iframe'\)/);
  assert.doesNotMatch(view, /thumbnail|img\.src|createElement\('img'\)/);
});

test('the frame is constrained, and the reasoning is written where it is set', () => {
  assert.match(view, /frame\.setAttribute\(\s*'sandbox'/);
  assert.match(view, /allow-scripts allow-same-origin/);
  // Not the ones that would let it act as the page: no forms, no top-level
  // navigation.
  assert.doesNotMatch(view, /allow-top-navigation/);
  assert.doesNotMatch(view, /allow-forms/);
  assert.match(view, /referrerPolicy = 'strict-origin-when-cross-origin'/);
});

test('the embed address is derived, never read from the document', () => {
  // So tightening the allowlist reaches documents already written — which is the
  // opposite of what storing the frame's address would give us.
  assert.match(view, /readVideoLink\(textOf\(this\.node, 'url'\)\)/);
  // The attribute simply does not exist, which is the whole of the guarantee.
  // (Not asserted against the comment that explains it: `codeOf` strips prose on
  // purpose, so that a test cannot be silenced by rewording a comment.)
  assert.doesNotMatch(schema, /embedUrl/);
});

test('an upload asks for metadata, not for the video', () => {
  // A page with six videos must not fetch six videos.
  assert.match(view, /player\.preload = 'metadata'/);
  assert.match(view, /player\.preload = 'none'/, 'and a stream fetches nothing at all');
});

test('a browser that cannot play HLS is told so, with a way to watch anyway', () => {
  // Safari and iOS play it natively, Chromium and Firefox do not, and this
  // application ships no player library. A black rectangle with no reason is the
  // one thing that must not happen.
  assert.match(view, /playsHlsNatively/);
  assert.match(view, /cannot play HLS by itself/);
  assert.match(view, /Open the stream/);
});

test('a refused address is shown as text and not as a link', () => {
  // One this declined to embed is not one to offer a click on either.
  const broken = view.slice(view.indexOf('private renderBroken'));
  assert.match(broken, /createElement\('span'\)/);
  assert.doesNotMatch(broken.slice(0, broken.indexOf('private title')), /createElement\('a'\)/);
});

test('a player reserves its shape before it knows it', () => {
  // Otherwise the page jumps when the metadata arrives.
  assert.match(css, /\.video-player \{[^}]*aspect-ratio: 16 \/ 9/);
  assert.match(css, /\.video-consent \{[^}]*aspect-ratio: 16 \/ 9/);
});

test('the node is one type with three sources', () => {
  // Not three node types: they are one thing in the document, and three would be
  // three node views and three sets of width handling to keep in step.
  assert.match(schema, /source: \{ default: 'file' \}/);
  assert.match(schema, /display: \{ default: 'player' \}/);
  assert.doesNotMatch(schema, /videoEmbed:|videoStream:/);
});
