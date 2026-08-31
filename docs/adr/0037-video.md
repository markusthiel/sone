# ADR-0037: Video is three different things, and only two of them are ours

## Status

Proposed.

## Context

Requested: a video content element, with three ways to get one into a page — upload
a file, paste a link from YouTube and the like, and publish a live stream — and the
same handle every other block has for choosing how it is drawn: content width, full
width, card, link, with content width the default.

The three sources look like one feature and are not. They differ in where the bytes
live, who they are fetched from, and what this application would have to become.

## The finding that decides the order

**Files are served whole, in memory, with no range support.**
`FileStore.get(key)` returns a `Buffer`, and the download route hands the entire
thing to the response. There is no `Accept-Ranges`, no `206`, no streaming from
storage.

For every file that exists today that is merely wasteful. For video it is fatal
twice over:

- **Seeking cannot work.** A browser seeks by asking for a byte range. Safari goes
  further and refuses to play a `<video>` at all over a response that does not
  advertise ranges — so an uploaded video would simply not play for a large share
  of the people this is built for.
- **The server holds the whole file per reader.** A 100 MB video watched by five
  people is 500 MB of resident memory, and `SONE_MAX_UPLOAD_MB` defaults to 100
  precisely because nothing here streams.

So range support is not a refinement to add after the block works. It is the
prerequisite, and it is worth doing on its own terms: every large download in the
application gets faster and cheaper, and a resumable download is something
operators expect.

## Decisions

### Range requests and streaming come first, as their own change

`FileStore` gains a range read — a stream and a length rather than a buffer — and
the download route answers `206` with `Content-Range` when asked, advertising
`Accept-Ranges: bytes` always. Local storage reads a slice of the file; S3 passes
the range through, which is what its API is for.

Everything that already works must keep working: a request without a `Range`
header gets exactly the response it gets today, headers included, because those
headers are load-bearing and documented as such.

### An uploaded video is a file, and the block says so

No new storage, no new upload path, no second concept of "media". A video is a
file in `files` with a category of its own, and the block holds a `fileId` — the
same shape the file block holds.

The upload limit will need raising for anybody who means it, and that is an
operator's decision rather than ours: `SONE_MAX_UPLOAD_MB` exists, and the
documentation should say what a sensible number is once streaming makes a large
one survivable.

### An embedded link is an allowlist, not an iframe

A pasted URL becomes a player only for providers this application knows how to
normalise: YouTube, Vimeo, and Peertube instances. Anything else becomes a link
card, which is the honest answer and already a shape we have.

Not arbitrary iframes. A block that embeds any URL in a document is a block that
embeds any URL in a *shared* document, and a share link is given to people outside
the workspace. An allowlist is the difference between "this page shows a video"
and "this page runs somebody else's code in your browser".

The privacy-preserving hosts are used where they exist — `youtube-nocookie.com`,
Vimeo's `dnt=1` — and it is not enough on its own, which is the next decision.

### An embed does not load until it is played

The block draws its own card — the provider, the title if we have one, a play
control — and the third-party iframe is created only when somebody presses it.

This is self-hosted software. Somebody who reads a page containing a YouTube embed
should not have told Google they read it merely by opening the page, and every
reader of every page carrying that block otherwise does. One click is a small price
and a familiar pattern.

It also means no third-party request happens for a page nobody watches, which
matters on a page with twelve videos.

### A live stream is a URL we play, not a service we run

Here I am proposing something narrower than was asked for, and the reason matters
more than the feature.

"Publish a live stream" means ingest, transcoding, packaging and an edge — RTMP or
SRT in, HLS out, at a bandwidth profile that is a different operational problem
from a notes application. That is a product, not a block. Building a bad version of
it inside SONE would make every instance responsible for something its operator did
not sign up to run.

What this block will do:

- **Play an HLS or DASH URL in place.** Somebody already streaming — OBS to their
  own server, a camera, a university's stream — pastes the manifest URL and it
  plays, with the same click-to-load rule as an embed.
- **Embed a provider's live page** through the same allowlist, because a YouTube
  live stream is just an embed.

What it will not do: accept an ingest. If that is genuinely wanted, it is its own
ADR and probably its own service beside SONE rather than inside it.

### Width and display are the two attributes that already exist

`width` (content or full) is the shared block attribute every block has. `display`
is the file block's own — player, card, or link — and its comment already explains
why the two are separate: "Width says how much room a block takes; display says
which of three quite different things to draw".

So nothing new is invented for the handle. The default is content width and the
player, as asked.

A live stream has no card or link form worth having — a card for something that is
only interesting while it is live is a dead link tomorrow — so those two are
offered for a file and an embed and hidden for a stream.

### One block type, three sources

`video` with `source: 'file' | 'embed' | 'stream'`. Not three block types: they are
one thing in the document — a video in a page — and three types would mean three
node views, three menus and three sets of width handling to keep in step.

Adding a node type is additive for a client that knows it and invisible to one that
does not, which is what the stale-bundle warning already exists to catch:
`isStaleBundle` tells somebody holding an old bundle that the server is newer.
`SCHEMA_VERSION` stays 1 — a new block type is not a format change, in the same way
`kind: 'folder'` was not (ADR-0019).

## Consequences

Two changes, in order: range support in file serving, then the block. The first is
useful alone and is where the risk is, because it touches a route with security
headers that are individually load-bearing.

A page with an embed makes no third-party request until somebody watches, which is
a property worth keeping and worth a test.

Somebody will paste a link to a provider not on the allowlist and get a link card.
That is the intended answer and the interface has to say it plainly rather than
looking broken.

## Alternatives considered

**Serve video with a redirect to storage** (a signed S3 URL), which is how most
applications avoid the streaming problem. Rejected for now: it works only for S3,
leaves local storage — the default — with no answer, and moves authorisation from a
route that checks page permissions to a URL that cannot.

**Arbitrary iframe embedding with a sandbox attribute.** Cheaper and more
permissive. Rejected: `sandbox` constrains what the frame may do, not who it tells
about the reader, and it is one attribute away from being wrong forever.

**Loading embeds immediately, with a setting to disable.** Rejected: the default is
what almost everybody runs, so a privacy default that has to be found in settings
is a privacy default nobody has.

**A generic `media` block covering image, video and audio.** Tempting, and the
right shape if it were being designed from nothing. Rejected because `image` and
`file` already exist with their own node views and behaviour, and merging them is a
migration of existing documents for tidiness rather than for a user.
