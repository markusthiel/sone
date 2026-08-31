/**
 * What a pasted video link is, if it is one we will embed (ADR-0037).
 *
 * An allowlist, not a URL-to-iframe converter. A block that embeds any address in
 * a document embeds any address in a *shared* document, and a share link is given
 * to people outside the workspace — so the difference between this and a generic
 * embed block is the difference between "this page shows a video" and "this page
 * runs somebody else's code in your browser".
 *
 * Pure and here rather than in the client, for the usual reason: the server has to
 * reach the same verdict as the browser. A block arriving over the API with an
 * embed URL nothing recognises must be refused by the same rule that decided not
 * to offer it in the first place.
 *
 * ## Privacy is part of the normalisation
 *
 * Where a provider offers a host that does not track a viewer who has not asked
 * to be tracked, that is the host used: `youtube-nocookie.com`, and Vimeo's
 * `dnt=1`. It is not sufficient on its own — the frame still speaks to them the
 * moment it exists, which is why the block does not create it until somebody
 * presses play — but choosing the worse host when a better one exists would be a
 * decision nobody could defend.
 */

/** A provider this recognises. */
export type VideoProvider = 'youtube' | 'vimeo' | 'peertube';

export interface EmbeddedVideo {
  provider: VideoProvider;
  /** What goes in the frame, once somebody has asked for it. */
  embedUrl: string;
  /** Where the video lives, for the link form and for "open in a new tab". */
  pageUrl: string;
}

/** Hosts that are YouTube, including the short form and the privacy host. */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);

const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

/**
 * A YouTube id is eleven characters of a known alphabet.
 *
 * Checked rather than trusted: the id is interpolated into the URL that becomes a
 * frame's source, so anything that is not an id must not reach it.
 */
const YOUTUBE_ID = /^[\w-]{11}$/;
const DIGITS = /^\d+$/;
/** A PeerTube video is addressed by a UUID or a short id of the same alphabet. */
const PEERTUBE_ID = /^[\w-]{6,40}$/;

/** A start time, in whole seconds, if the link carries one. */
function startSeconds(url: URL): number | null {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (raw === null) return null;

  // `t=90`, `t=90s`, `t=1m30s`, `t=1h2m3s` — YouTube writes all of them.
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw.trim());
  if (!match) return null;
  const [, h, m, s] = match;
  const total = Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  return total > 0 ? total : null;
}

/**
 * Read a link, or refuse it.
 *
 * `null` means "not a provider we embed", which is a normal answer and becomes a
 * link card rather than an error.
 */
export function readVideoLink(raw: string): EmbeddedVideo | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  // http is refused rather than upgraded. A frame loaded over http in a page
  // served over https is blocked by the browser anyway, and silently rewriting
  // somebody's address is worse than saying no.
  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  const at = startSeconds(url);

  if (YOUTUBE_HOSTS.has(host)) {
    // Three shapes: youtu.be/ID, /watch?v=ID, and /embed/ID or /shorts/ID.
    const path = url.pathname.replace(/^\/+/, '');
    const id =
      host === 'youtu.be'
        ? path.split('/')[0]
        : (url.searchParams.get('v') ??
          (/^(embed|shorts|live|v)\//.test(path) ? path.split('/')[1] : undefined));

    if (!id || !YOUTUBE_ID.test(id)) return null;
    const embed = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
    if (at !== null) embed.searchParams.set('start', String(at));
    return {
      provider: 'youtube',
      embedUrl: embed.toString(),
      pageUrl: `https://www.youtube.com/watch?v=${id}`,
    };
  }

  if (VIMEO_HOSTS.has(host)) {
    const id = url.pathname.replace(/^\/+/, '').split('/')[0];
    if (!id || !DIGITS.test(id)) return null;
    const embed = new URL(`https://player.vimeo.com/video/${id}`);
    embed.searchParams.set('dnt', '1');
    if (at !== null) embed.searchParams.set('t', `${at}s`);
    return {
      provider: 'vimeo',
      embedUrl: embed.toString(),
      pageUrl: `https://vimeo.com/${id}`,
    };
  }

  // PeerTube is not one host but thousands, so it is recognised by its address
  // shape instead: /w/<id> is what every instance serves.
  //
  // A deliberate difference in kind from the two above, and the reason it is
  // acceptable: a PeerTube instance is somebody's own server, which is the same
  // bargain this application is. It is still a frame from a host the reader did
  // not choose, which is why click-to-play applies to it exactly as it does to
  // the others.
  const peertube = /^\/(?:w|videos\/watch)\/([\w-]{6,40})\/?$/.exec(url.pathname);
  if (peertube) {
    const id = peertube[1]!;
    if (!PEERTUBE_ID.test(id)) return null;
    const embed = new URL(`https://${host}/videos/embed/${id}`);
    if (at !== null) embed.searchParams.set('start', `${at}s`);
    return {
      provider: 'peertube',
      embedUrl: embed.toString(),
      pageUrl: `https://${host}/w/${id}`,
    };
  }

  return null;
}

/**
 * Whether an address is a stream this can play itself (ADR-0037).
 *
 * HLS or DASH, recognised by the manifest's extension because that is all there
 * is to go on before fetching it — and fetching it to find out would be the
 * third-party request the whole design avoids until somebody presses play.
 *
 * No ingest, no transcoding: somebody already streaming points this at their
 * manifest. Publishing a stream is a service, not a block, and building a poor
 * version of one inside a notes application would make every operator
 * responsible for something they did not sign up to run.
 */
export function readStreamLink(raw: string): { url: string; kind: 'hls' | 'dash' } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const path = url.pathname.toLowerCase();
  if (path.endsWith('.m3u8')) return { url: url.toString(), kind: 'hls' };
  if (path.endsWith('.mpd')) return { url: url.toString(), kind: 'dash' };
  return null;
}

/**
 * What a video block may be set to, and what it may be drawn as.
 *
 * `display` mirrors the file block's rather than inventing a scale: width says
 * how much room a block takes, display says which of several quite different
 * things to draw. A player, a card, and a link are not points on one scale.
 *
 * A stream has no card or link worth having — a card for something that is only
 * interesting while it is live is a dead link tomorrow — so those are offered for
 * a file and an embed only.
 */
export const VIDEO_SOURCES = ['file', 'embed', 'stream'] as const;
export type VideoSource = (typeof VIDEO_SOURCES)[number];

export const VIDEO_DISPLAYS = ['player', 'card', 'link'] as const;
export type VideoDisplay = (typeof VIDEO_DISPLAYS)[number];

/** Which display forms make sense for a source. */
export function displaysFor(source: VideoSource): readonly VideoDisplay[] {
  return source === 'stream' ? ['player'] : VIDEO_DISPLAYS;
}
