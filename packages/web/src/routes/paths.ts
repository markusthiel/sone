/**
 * SONE web — URL structure.
 *
 * A public contract (ADR-0016): share links get written into emails, and a link
 * sent today must work in two years. Every URL in the app is built through this
 * module so the shape cannot drift.
 *
 * Four properties, each with a reason:
 *   - The page id is in the path and the slug is decorative, so renaming a page
 *     never breaks a link.
 *   - Share links live under /s/, a separate space from /p/, because an
 *     anonymous visitor's URL must not be confusable with a member's — the two
 *     carry different authorisation and the difference should be visible in the
 *     address bar.
 *   - A share link keeps its prefix while navigating its subtree, or clicking a
 *     subpage drops the credential and hits a login wall mid-document.
 *   - No workspace id in the path: the session carries it, so a page moving
 *     between workspaces does not invalidate every link to it.
 *
 * Tokens are path segments rather than query parameters, so they stay out of
 * Referer headers on outbound links.
 */

/** Decorative slug. Never parsed back — the id is the identity. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks, so "Übersicht" becomes "ubersicht" rather than
    // losing the character entirely.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Marks a fragment as naming a block rather than a heading anchor. */
export const BLOCK_FRAGMENT = 'b-';

/** The block a fragment names, or null. */
export function blockFromHash(hash: string): string | null {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  return value.startsWith(BLOCK_FRAGMENT) ? value.slice(BLOCK_FRAGMENT.length) : null;
}

export const paths = {
  home: () => '/',
  login: () => '/login',
  /** Where a reset link lands, and where "forgot?" goes (ADR-0059). */
  reset: (token?: string) => (token ? `/reset?token=${encodeURIComponent(token)}` : '/reset'),
  signup: (invitationToken?: string) =>
    invitationToken ? `/signup?invite=${encodeURIComponent(invitationToken)}` : '/signup',
  setup: () => '/setup',
  search: (query?: string) =>
    query ? `/search?q=${encodeURIComponent(query)}` : '/search',
  /** Your own settings (ADR-0032). */
  settings: (section = 'profile') => `/settings/${section}`,
  /** The workspace you are in. */
  /** Every workspace this person may see (ADR-0067). */
  workspaces: () => '/workspaces',

  /**
   * A workspace's settings (ADR-0067).
   *
   * With no id it means the one you are in — the shortcut the account menu
   * uses. With one it is that workspace, which is how the administration's list
   * opens it.
   */
  workspaceSettings: (section = 'general', workspaceId?: string) =>
    workspaceId
      ? `/workspace/${encodeURIComponent(workspaceId)}/${section}`
      : `/workspace/${section}`,
  /** The instance everybody shares. Only offered with the right. */
  admin: (section = 'instance') => `/admin/${section}`,
  trash: () => '/trash',
  /** What is waiting, across every workspace (ADR-0052). */
  inbox: () => '/inbox',

  /**
   * A page, optionally at one of its blocks.
   *
   * The block is a fragment rather than a path segment: it is a position within
   * the page and not a different page, and a fragment never reaches the server —
   * which is right for something only the interface acts on. Used by search, so
   * a result can land on the sentence that matched (ADR-0033).
   */
  page: (pageId: string, title?: string, blockId?: string | null) => {
    const slug = title ? slugify(title) : '';
    const path = slug ? `/p/${pageId}/${slug}` : `/p/${pageId}`;
    return blockId ? `${path}#${BLOCK_FRAGMENT}${blockId}` : path;
  },

  share: (token: string) => `/s/${token}`,
  sharePage: (token: string, pageId: string, title?: string) => {
    const slug = title ? slugify(title) : '';
    return slug ? `/s/${token}/p/${pageId}/${slug}` : `/s/${token}/p/${pageId}`;
  },
};

/**
 * Where the one settings screen's sections went (ADR-0032).
 *
 * URLs are a public contract, and these are in the sidebar, in the workspace
 * switcher and in whatever anybody has bookmarked — so an old one is redirected
 * rather than answered with a not-found page.
 *
 * One table, and it is meant to be deleted: after a release the redirect is
 * carrying links nobody holds any more. What it must not do is quietly become
 * permanent, so it says so here.
 */
export const MOVED_SETTINGS: Record<string, string> = {
  account: '/settings/profile',
  theme: '/workspace/typography',
  groups: '/workspace/groups',
  // These two were never in the navigation and were reachable only by typing
  // the URL. Redirected anyway: somebody following an old note is exactly who
  // would have typed one.
  'workspaces-legacy': '/workspace/general',
  'workspaces-old': '/admin/workspaces',
  workspaces: '/admin/workspaces',
  instance: '/admin/instance',
  accounts: '/admin/accounts',
  invite: '/admin/invite',
  sso: '/admin/sso',
  maintenance: '/admin/maintenance',
};

export type Route =
  | { kind: 'home' }
  | { kind: 'login' }
  | { kind: 'signup'; invitationToken: string | null }
  | { kind: 'reset'; token: string | null }
  | { kind: 'setup' }
  | { kind: 'search'; query: string }
  | { kind: 'settings'; section: string }
  | { kind: 'workspaceList' }
  | { kind: 'workspaceSettings'; workspaceId: string | null; section: string }
  | { kind: 'admin'; section: string }
  | { kind: 'trash' }
  | { kind: 'inbox' }
  | { kind: 'page'; pageId: string }
  | { kind: 'share'; token: string; pageId: string | null }
  | { kind: 'notFound' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse a location into a route.
 *
 * Ids are validated here rather than downstream: a malformed id should render a
 * not-found page, not produce a failed API call that looks like a server fault.
 */
export function parseRoute(pathname: string, search = ''): Route {
  const params = new URLSearchParams(search);
  const segments = pathname.split('/').filter((s) => s !== '');

  if (segments.length === 0) return { kind: 'home' };

  switch (segments[0]) {
    case 'login':
      return { kind: 'login' };
    case 'signup':
      return { kind: 'signup', invitationToken: params.get('invite') };
    case 'setup':
      return { kind: 'setup' };
    /*
     * Setting a new password (ADR-0059).
     *
     * The token in the query rather than the path, so it is not part of a
     * segment somebody might mistake for a page id — and because the link is
     * built by the server, which does the same for invitations.
     */
    case 'reset':
      return { kind: 'reset', token: params.get('token') };
    case 'search':
      return { kind: 'search', query: params.get('q') ?? '' };
    case 'settings':
      return { kind: 'settings', section: segments[1] ?? 'profile' };
    case 'workspaces':
      // The list, which everybody may open — the answer's length is the right.
      return { kind: 'workspaceList' };
    case 'workspace':
      /*
       * The workspace is named in the address (ADR-0067).
       *
       * `/workspace/general` used to mean "the one I am in", which is why there
       * had to be a second screen for any other one. With the id in the path
       * there is one screen and one URL, reachable from the administration's
       * list and from the account menu alike — and linkable, which the old form
       * was not.
       *
       * The one-segment form is still understood, so a link somebody kept means
       * "the workspace I am in" rather than nothing.
       */
      return segments.length > 2
        ? {
            kind: 'workspaceSettings',
            workspaceId: segments[1] ?? null,
            section: segments[2] ?? 'general',
          }
        : {
            kind: 'workspaceSettings',
            workspaceId: null,
            section: segments[1] ?? 'general',
          };
    case 'admin':
      return { kind: 'admin', section: segments[1] ?? 'instance' };
    case 'trash':
      return { kind: 'trash' };
    /*
     * Outside any workspace, deliberately.
     *
     * An inbox spans them — the whole point is being told about a question
     * asked somewhere other than where somebody is standing — so a path with a
     * workspace in it would be a lie about what the screen shows.
     */
    case 'inbox':
      return { kind: 'inbox' };

    case 'p': {
      const pageId = segments[1];
      if (!pageId || !UUID_RE.test(pageId)) return { kind: 'notFound' };
      return { kind: 'page', pageId };
    }

    case 's': {
      const token = segments[1];
      if (!token) return { kind: 'notFound' };
      if (segments[2] === 'p') {
        const pageId = segments[3];
        if (!pageId || !UUID_RE.test(pageId)) return { kind: 'notFound' };
        return { kind: 'share', token, pageId };
      }
      return { kind: 'share', token, pageId: null };
    }

    default:
      return { kind: 'notFound' };
  }
}
