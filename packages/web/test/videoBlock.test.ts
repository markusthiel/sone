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

// --- getting one into a page ------------------------------------------------

const surface = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));
const dialog = codeOf(new URL('../src/components/VideoDialog.tsx', import.meta.url));
const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));
const slash = codeOf(new URL('../../editor/src/slashMenu.ts', import.meta.url));

test('the slash menu offers it, and asks rather than opening a picker', () => {
  // Two of the three sources are addresses, and a file picker cannot ask for one.
  assert.match(slash, /id: 'video'/);
  const slashMenu = codeOf(new URL('../src/components/SlashMenu.tsx', import.meta.url));
  assert.match(slashMenu, /item\.id === 'video'/);
  assert.match(slashMenu, /onInsertVideo\(\)/);
});

test('an address is read by the allowlist before a block exists', () => {
  // A refusal at that moment is a correction; a refusal afterwards is a broken
  // block. And it is the same function that draws it, which is what makes
  // tightening the list reach documents already written.
  assert.match(dialog, /readVideoLink\(trimmed\)/);
  assert.match(dialog, /readStreamLink\(trimmed\)/);
  assert.match(surface, /const embed = readVideoLink\(raw\)/);
});

test('the browser is asked whether it could play the file, before it is sent', () => {
  // An iPhone .mov carrying HEVC is the ordinary case and most browsers draw a
  // black rectangle for it. Nothing is transcoded (ADR-0037), so a sentence at
  // the moment of choosing is the whole of the help available.
  assert.match(surface, /probe\.canPlayType\(file\.type\)/);
  // The warning outlives the upload, which now has a progress line of its own —
  // so the check is that the verdict decides what is left on screen afterwards.
  assert.match(surface, /setNotice\(verdict === '' \? unplayableNotice\(file\) : null\)/);
  // A warning and not a refusal: it may play for the person it is meant for.
  assert.doesNotMatch(surface, /return;\s*\/\/ refuse the upload/);
});

test('a dropped video becomes a video, not an attachment named after one', () => {
  assert.match(surface, /file\.type\.startsWith\('video\/'\)\) await attachVideo\(file\)/);
});

test('the handle offers width, and the three shapes', () => {
  // Width is the shared block attribute; the shapes are the file block's. No
  // colour, and no alignment — a player aligned inside its own width is a
  // control with nothing to do.
  assert.match(menu, /video: \{ width: true, color: false, align: false \}/);
  assert.match(menu, /setVideoDisplay\(at, option\.id as 'player' \| 'card' \| 'link'\)/);
  assert.match(menu, /\{ id: 'player', label: 'Player' \}/);
});

test('a stream is offered as a player and nothing else, in both places', () => {
  // The menu agreeing with the command, rather than the menu deciding: a card for
  // something interesting only while live is a dead link tomorrow, whoever asked.
  assert.match(menu, /source === 'stream'\s*\?\s*\[\{ id: 'player', label: 'Player' \}\]/);
  const commands = codeOf(new URL('../../editor/src/commands.ts', import.meta.url));
  assert.match(commands, /source'\] === 'stream' && display !== 'player'\) return false/);
});

test('an upload offers Download, and not "the original"', () => {
  // An image has a smaller copy made for display, so "the original" means
  // something. A video is stored as it arrived; there is no second copy.
  const actions = menu.slice(menu.indexOf('function VideoActions'));
  const own = actions.slice(0, actions.indexOf('function ImageDisplay'));
  assert.match(own, /download=\{name\}/, 'the upload can be downloaded');
  assert.doesNotMatch(own, /original=true/, 'and there is no second copy to offer');
});
