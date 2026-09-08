/**
 * SONE web — routing.
 *
 * A hand-rolled router over the History API rather than a routing library. The
 * route space is small and fixed by ADR-0016, and a library would add a
 * dependency plus its own opinions about data loading for no benefit at this
 * size. Revisit if nested layouts or route-level code splitting arrive.
 */

import { useCallback, useEffect, useState } from 'react';

import { answersClick, internalTarget } from '../routes/internalLinks.ts';
import { parseRoute, type Route } from '../routes/paths.ts';

/**
 * That the address changed without the browser saying so (ADR-0170).
 *
 * `history.pushState` fires nothing — not `hashchange`, not `popstate`. That is
 * fine for the route, which this hook holds in state and sets itself, and not
 * fine for the fragment, which is read by a component several layers down that
 * this hook has no path to.
 *
 * So the one place that calls `pushState` says so, down the same kind of named
 * channel `sone:found-block` and `sone:open-thread` already use: each listener
 * holds exactly the state it holds anyway.
 */
export const NAVIGATED_EVENT = 'sone:navigated';

export function useRoute(): {
  route: Route;
  navigate: (to: string, options?: { replace?: boolean }) => void;
} {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.pathname, window.location.search),
  );

  useEffect(() => {
    const onPop = (): void => {
      setRoute(parseRoute(window.location.pathname, window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (options?.replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    setRoute(parseRoute(url.pathname, url.search));
    window.dispatchEvent(new Event(NAVIGATED_EVENT));
  }, []);

  return { route, navigate };
}

/**
 * The fragment currently in the address bar.
 *
 * Its own hook rather than a value threaded down from `useRoute`, because the
 * one component that needs it — the page, landing on the block a link named —
 * is rendered by two different shells and neither of them has any other reason
 * to know about fragments. `useRoute` called a second time would be a second
 * independent copy of the route's state, which is worse than either.
 */
export function useLocationHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const read = (): void => setHash(window.location.hash);
    window.addEventListener('popstate', read);
    window.addEventListener('hashchange', read);
    window.addEventListener(NAVIGATED_EVENT, read);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener('hashchange', read);
      window.removeEventListener(NAVIGATED_EVENT, read);
    };
  }, []);

  return hash;
}

/**
 * Intercept in-app link clicks.
 *
 * Registered once at the app root rather than replacing every anchor with a
 * component. Real anchors keep middle-click, cmd-click and "copy link address"
 * working, which a div with an onClick does not — and for an app whose URLs are
 * a public contract, copying a link has to work.
 */
export function useLinkInterception(
  navigate: (to: string, options?: { replace?: boolean }) => void,
  /**
   * The share token this person is reading through, or null.
   *
   * From the route rather than from context, because this is registered at the
   * app root — above the provider — and because the address bar is the honest
   * answer to *where is this person standing*. An internal link stored in a
   * document deliberately carries no token (see `internalLinks.ts`); this is
   * where the reader's own credential is put back on.
   */
  shareToken: string | null = null,
): void {
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      // Let the browser handle anything that is not a plain left click.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      /*
       * A click in text somebody is writing is not ours (ADR-0171).
       *
       * Editable text already answers it, and answers it better: the caret goes
       * into the word and the card offers *open*. This was answering first, so
       * a link home was followed on a plain click while a link out was not —
       * one gesture, two meanings, decided by which host the address named.
       */
      if (!answersClick(anchor)) return;

      const to = internalTarget(href, window.location.origin, shareToken);
      if (to === null) return;

      event.preventDefault();
      navigate(to);
    };

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate, shareToken]);
}
