/**
 * The video link allowlist (ADR-0037).
 *
 * Most of these are about what is refused. A block that embeds any address in a
 * document embeds any address in a *shared* document, and a share link goes to
 * people outside the workspace — so the interesting cases are the ones that must
 * not become a frame.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { displaysFor, readStreamLink, readVideoLink } from '../src/video/links.js';

test('the three YouTube shapes all read as the same video', () => {
  for (const link of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
  ]) {
    const read = readVideoLink(link);
    assert.equal(read?.provider, 'youtube', link);
    assert.equal(read?.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', link);
    assert.equal(read?.pageUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', link);
  }
});

test('the privacy host is the one embedded, where a provider has one', () => {
  // Not sufficient on its own — the frame still speaks to them the moment it
  // exists, which is why nothing is created until somebody presses play — but
  // choosing the worse host when a better one exists is indefensible.
  assert.match(
    readVideoLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.embedUrl ?? '',
    /youtube-nocookie\.com/,
  );
  assert.match(readVideoLink('https://vimeo.com/76979871')?.embedUrl ?? '', /\bdnt=1\b/);
});

test('a start time survives the normalisation, in every form YouTube writes', () => {
  const at = (t: string): string =>
    readVideoLink(`https://youtu.be/dQw4w9WgXcQ?t=${t}`)?.embedUrl ?? '';
  assert.match(at('90'), /start=90/);
  assert.match(at('90s'), /start=90/);
  assert.match(at('1m30s'), /start=90/);
  assert.match(at('1h2m3s'), /start=3723/);
});

test('an id that is not an id does not reach the frame', () => {
  // The id is interpolated into the address a frame loads, so anything else must
  // be refused rather than passed through.
  assert.equal(readVideoLink('https://www.youtube.com/watch?v=../../evil'), null);
  assert.equal(readVideoLink('https://www.youtube.com/watch?v=short'), null);
  assert.equal(readVideoLink('https://www.youtube.com/watch?v='), null);
  assert.equal(readVideoLink('https://vimeo.com/not-a-number'), null);
});

test('a host that is not on the list is not embedded', () => {
  // Including the ones that look like a provider. `youtube.com.evil.test` is the
  // oldest trick there is, and a substring check would fall for it.
  for (const link of [
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://evil.test/embed/dQw4w9WgXcQ',
    'https://vimeo.com.evil.test/76979871',
  ]) {
    assert.equal(readVideoLink(link), null, link);
  }
});

test('http is refused rather than upgraded', () => {
  // A frame loaded over http in a page served over https is blocked by the
  // browser anyway, and rewriting somebody's address silently is worse than no.
  assert.equal(readVideoLink('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(readStreamLink('http://stream.test/live.m3u8'), null);
});

test('a javascript or data address is not a video', () => {
  assert.equal(readVideoLink('javascript:alert(1)'), null);
  assert.equal(readVideoLink('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(readVideoLink('not a url at all'), null);
});

test('PeerTube is recognised by the shape of its address, not its host', () => {
  // It is thousands of hosts rather than one. Acceptable because an instance is
  // somebody's own server, which is the same bargain this application is — and
  // click-to-play applies to it exactly as it does to the others.
  const read = readVideoLink('https://tube.example.org/w/abcdefghijkl');
  assert.equal(read?.provider, 'peertube');
  assert.equal(read?.embedUrl, 'https://tube.example.org/videos/embed/abcdefghijkl');
  assert.equal(read?.pageUrl, 'https://tube.example.org/w/abcdefghijkl');
});

test('a stream is a manifest, and nothing else', () => {
  assert.deepEqual(readStreamLink('https://stream.test/live.m3u8'), {
    url: 'https://stream.test/live.m3u8',
    kind: 'hls',
  });
  assert.deepEqual(readStreamLink('https://stream.test/live.mpd'), {
    url: 'https://stream.test/live.mpd',
    kind: 'dash',
  });
  // Not a guess from anything else: finding out by fetching it would be the
  // third-party request the whole design avoids until somebody presses play.
  assert.equal(readStreamLink('https://stream.test/live'), null);
  assert.equal(readStreamLink('https://stream.test/video.mp4'), null);
});

test('a stream has no card or link form', () => {
  // A card for something only interesting while it is live is a dead link
  // tomorrow.
  assert.deepEqual(displaysFor('stream'), ['player']);
  assert.deepEqual(displaysFor('file'), ['player', 'card', 'link']);
  assert.deepEqual(displaysFor('embed'), ['player', 'card', 'link']);
});
