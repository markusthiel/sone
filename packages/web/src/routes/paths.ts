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

export const paths = {
  home: () => '/',
  login: () => '/login',
  signup: (invitationToken?: string) =>
    invitationToken ? `/signup?invite=${encodeURIComponent(invitationToken)}` : '/signup',
  setup: () => '/setup',
  search: (query?: string) =>
    query ? `/search?q=${encodeURIComponent(query)}` : '/search',
  settings: (section = 'account') => `/settings/${section}`,
  trash: () => '/trash',

  page: (pageId: string, title?: string) => {
    const slug = title ? slugify(title) : '';
    return slug ? `/p/${pageId}/${slug}` : `/p/${pageId}`;
  },

  share: (token: string) => `/s/${token}`,
  sharePage: (token: string, pageId: string, title?: string) => {
    const slug = title ? slugify(title) : '';
    return slug ? `/s/${token}/p/${pageId}/${slug}` : `/s/${token}/p/${pageId}`;
  },
};

export type Route =
  | { kind: 'home' }
  | { kind: 'login' }
  | { kind: 'signup'; invitationToken: string | null }
  | { kind: 'setup' }
  | { kind: 'search'; query: string }
  | { kind: 'settings'; section: string }
  | { kind: 'trash' }
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
    case 'search':
      return { kind: 'search', query: params.get('q') ?? '' };
    case 'settings':
      return { kind: 'settings', section: segments[1] ?? 'account' };
    case 'trash':
      return { kind: 'trash' };

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
