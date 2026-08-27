/**
 * SONE web — routing.
 *
 * A hand-rolled router over the History API rather than a routing library. The
 * route space is small and fixed by ADR-0016, and a library would add a
 * dependency plus its own opinions about data loading for no benefit at this
 * size. Revisit if nested layouts or route-level code splitting arrive.
 */

import { useCallback, useEffect, useState } from 'react';

import { parseRoute, type Route } from '../routes/paths.ts';

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
  }, []);

  return { route, navigate };
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

      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return;

      event.preventDefault();
      navigate(url.pathname + url.search);
    };

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);
}
