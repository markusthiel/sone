/**
 * SONE web — session state.
 *
 * One request for session and workspaces together, because the app cannot
 * render anything before it has both and a second round trip is a second
 * chance to flicker.
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api, type InstanceInfo, type SessionInfo } from '../api/client.ts';
import { clearLocalDocs } from '../storage/localDocs.ts';
import { forgetLinkTargets } from './useLinkTargets.ts';

export type SessionState =
  | { status: 'loading' }
  /** No instance yet; first-run setup is required. */
  | { status: 'needsSetup'; instance: InstanceInfo }
  | { status: 'anonymous'; instance: InstanceInfo }
  | {
      status: 'authenticated';
      session: SessionInfo;
      workspaceId: string;
      /** The instance's own settings, which the interface is addressed by. */
      instance: InstanceInfo;
    }
  | { status: 'error'; code: string };

const LAST_WORKSPACE_KEY = 'sone.lastWorkspace';

export function useSession(): {
  state: SessionState;
  reload: () => Promise<void>;
  selectWorkspace: (workspaceId: string) => void;
  logout: () => Promise<void>;
} {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const reload = useCallback(async () => {
    try {
      const instance = await api.instance();
      if (instance.needsSetup) {
        setState({ status: 'needsSetup', instance });
        return;
      }

      try {
        const session = await api.session();
        const remembered = localStorage.getItem(LAST_WORKSPACE_KEY);
        // Prefer the last workspace, but only if the user is still a member —
        // a remembered id from a workspace they were removed from would
        // otherwise leave them staring at an empty sidebar.
        const workspaceId =
          session.workspaces.find((w) => w.id === remembered)?.id ??
          session.workspaces[0]?.id;

        if (!workspaceId) {
          // An account with no workspace: valid, and the UI must say something
          // rather than render an empty shell.
          setState({ status: 'error', code: 'no_workspace' });
          return;
        }
        setState({ status: 'authenticated', session, workspaceId, instance });
      } catch (err) {
        if (err instanceof ApiError && err.isAuthError) {
          setState({ status: 'anonymous', instance });
          return;
        }
        throw err;
      }
    } catch (err) {
      setState({
        status: 'error',
        code: err instanceof ApiError ? err.code : 'network_error',
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
    setState((current) =>
      current.status === 'authenticated' ? { ...current, workspaceId } : current,
    );
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {
      // A failed logout must still clear local state, or the user appears
      // logged in with a cookie the server has already revoked.
    });
    localStorage.removeItem(LAST_WORKSPACE_KEY);
    // Local copies go with the session.
    //
    // Signing out and leaving somebody's documents in the browser is the
    // failure this guards against: the next person at that machine would find
    // them in storage, readable without any credential at all.
    await clearLocalDocs();
    /*
     * And the pages a `[[` picker was holding (ADR-0178).
     *
     * Titles from every workspace this person was a member of, cached at module
     * scope so the picker never pauses while somebody types (ADR-0176) — and a
     * logout is not a reload, so that cache outlives it. The next person to
     * type `[[` in this tab would be offered somebody else's workspace, which
     * is the failure the line above is about, in memory rather than in storage.
     */
    forgetLinkTargets();
    await reload();
  }, [reload]);

  return { state, reload, selectWorkspace, logout };
}
