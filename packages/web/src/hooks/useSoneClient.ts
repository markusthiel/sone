/**
 * SONE web — the client binding.
 *
 * The only place React touches @sone/client. Everything below this file is
 * framework-free (ADR-0016).
 */

import {
  SoneClient,
  type ConnectionFailure,
  type ConnectionState,
  type PageHandle,
} from '@sone/client';
import { useEffect, useMemo, useRef, useState } from 'react';

import { persistLocally } from '../storage/localDocs.ts';

const SHARE_SESSION_KEY = 'sone.shareSession';

export interface ClientCredentials {
  workspaceId: string;
  sessionToken?: string;
  shareToken?: string;
  displayName?: string;
  /**
   * Who is editing, for attribution (ADR-0022).
   *
   * Absent for a share-link guest, who has no user id to record *against* —
   * attributing to "a guest" would produce one contributor that is really
   * several people, which is worse than saying nothing.
   */
  userId?: string;
}

/**
 * Create and hold a SoneClient for the lifetime of a workspace or share link.
 *
 * A member connection sends no credential at all: the session cookie is
 * HttpOnly, so JavaScript cannot read it, and it travels with the WebSocket
 * upgrade request anyway because that is an ordinary same-origin request. The
 * server reads it there. Making the cookie readable to send it explicitly
 * would hand any XSS a usable credential, and a notes app renders a great deal
 * of user-supplied content.
 *
 * A share link is different: its token is in the URL, so it is passed
 * explicitly.
 */
export function useSoneClient(credentials: ClientCredentials | null): {
  client: SoneClient | null;
  state: ConnectionState;
  /** Why the connection is not up, if it is not. */
  failure: ConnectionFailure | null;
  fatal: { code: string } | null;
  passwordRequired: boolean;
  submitPassword: (password: string) => void;
} {
  const [state, setState] = useState<ConnectionState>('idle');
  const [failure, setFailure] = useState<ConnectionFailure | null>(null);
  const [fatal, setFatal] = useState<{ code: string } | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const clientRef = useRef<SoneClient | null>(null);

  // Serialised so the effect re-runs on a real change rather than on every
  // render, without asking callers to memoise the object themselves.
  const key = credentials
    ? `${credentials.workspaceId}|${credentials.shareToken ?? ''}|${credentials.displayName ?? ''}|${credentials.userId ?? ''}`
    : null;

  const client = useMemo(() => {
    if (!credentials) return null;

    const url = new URL('/sync', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    const stored = credentials.shareToken
      ? sessionStorage.getItem(`${SHARE_SESSION_KEY}:${credentials.shareToken}`)
      : null;

    return new SoneClient({
      url: url.toString(),
      credentials: {
        workspaceId: credentials.workspaceId,
        // No token for a member: the cookie does the work. See above.
        ...(credentials.shareToken ? { shareToken: credentials.shareToken } : {}),
        ...(credentials.displayName ? { displayName: credentials.displayName } : {}),
        ...(stored ? { shareSessionId: stored } : {}),
      },
      // A local copy, for members only.
      //
      // A guest arriving through a share link is often on a borrowed or shared
      // machine, and leaving somebody else's document in that browser's storage
      // is a disclosure they never agreed to: the link gave them access to read
      // a page, not a reason to keep it.
      //
      // This is what makes an edit survive a reload. It already survived a lost
      // connection — the CRDT holds it in memory — but not the case that
      // actually happens: a tab restored after a crash, a phone that suspended
      // the page.
      ...(credentials.shareToken ? {} : { persist: persistLocally }),
      presence: {
        displayName: credentials.displayName ?? 'Someone',
        color: pickColor(credentials.displayName ?? ''),
        // The person, so their edits can be attributed. This was hardcoded to
        // null, which switched attribution off everywhere: `recordAttribution`
        // returns early without a user id, so no mapping was ever written and
        // the people panel had nothing to list — on every page, since the day it
        // was built.
        userId: credentials.userId ?? null,
        isAnonymous: Boolean(credentials.shareToken),
      },
      onStateChange: (next) => {
        setState(next);
        // Cleared on success, so a warning does not outlive the problem.
        if (next === 'ready') setFailure(null);
      },
      onConnectionTrouble: setFailure,
      onFatal: (code) => setFatal({ code }),
      onPasswordRequired: () => setPasswordRequired(true),
      onShareSession: (id) => {
        if (credentials.shareToken) {
          // sessionStorage rather than localStorage: an anonymous session
          // belongs to this tab, and sharing it across tabs would make two
          // windows appear as one cursor.
          sessionStorage.setItem(`${SHARE_SESSION_KEY}:${credentials.shareToken}`, id);
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!client) return;
    clientRef.current = client;
    setFatal(null);
    setPasswordRequired(false);
    client.connect();

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [client]);

  return {
    client,
    state,
    failure,
    fatal,
    passwordRequired,
    submitPassword: (password: string) => {
      setPasswordRequired(false);
      clientRef.current?.connection.retryAuth(password);
    },
  };
}

/**
 * Subscribe to a page.
 *
 * Returns the handle and re-renders on status, role and presence changes. The
 * handle is released on unmount, which is what makes the store's refcounting
 * work: two components on the same page share one Y.Doc.
 */
export function usePage(client: SoneClient | null, pageId: string | null): PageHandle | null {
  const [, forceRender] = useState(0);
  const handleRef = useRef<PageHandle | null>(null);

  useEffect(() => {
    if (!client || !pageId) {
      handleRef.current = null;
      return;
    }

    const handle = client.openPage(pageId);
    handleRef.current = handle;
    forceRender((n) => n + 1);

    const unsubscribe = handle.subscribe(() => forceRender((n) => n + 1));

    return () => {
      unsubscribe();
      handle.release();
      handleRef.current = null;
    };
  }, [client, pageId]);

  return handleRef.current;
}

/** Stable colour per display name, so a person keeps the same cursor colour. */
function pickColor(seed: string): string {
  // Hues spaced widely enough to stay distinguishable, and lightness fixed so
  // every colour works on both light and dark backgrounds.
  const palette = [
    '#e5484d', '#e54d2e', '#f76b15', '#ffb224', '#46a758',
    '#12a594', '#0091ff', '#3e63dd', '#8e4ec6', '#e93d82',
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length]!;
}
