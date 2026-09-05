/**
 * Be told when a list changed, without fetching it once per statement.
 *
 * The server's nudge says which list to fetch again and nothing else
 * (ADR-0093), so every listener's answer to it is the same shape: refetch, and
 * do not refetch five times because one action arrived as five statements.
 *
 * Written inline in `usePages` first (ADR-0096) and extracted the moment the
 * trash needed the same thing (ADR-0097) — before there were three copies of
 * it, which is where this codebase has watched a rule go to be forgotten more
 * than once.
 *
 * **The window is a trailing one.** A nudge starts it and the refetch happens
 * at the end; further nudges inside it are already accounted for. A quarter of
 * a second: long enough to swallow the burst from one person's action, short
 * enough that a colleague's change appears while somebody is still looking at
 * the place it happened.
 *
 * The failure this shape can hide is not the burst — it is a window that never
 * reopens, which looks exactly like a push that works until the second change.
 * Every user of this hook has a test for that, and so does this hook.
 */

import { NotifyScope, type SoneClient } from '@sone/client';
import { useEffect, useRef } from 'react';

/** How long one nudge holds the door open for the ones behind it. */
export const NUDGE_WINDOW_MS = 250;

export type NudgeScope = (typeof NotifyScope)[keyof typeof NotifyScope];

export function useNudge(
  /** Null while the client is still being constructed, which is every first render. */
  client: SoneClient | null | undefined,
  scope: NudgeScope,
  onChanged: () => void,
): void {
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * The latest handler, without resubscribing for it.
   *
   * A caller passes a closure over its own state, so the identity changes on
   * most renders. Subscribing on every change would tear down and rebuild the
   * subscription — and, worse, drop a window that was already open, which is
   * the one failure this hook exists to prevent.
   */
  const latest = useRef(onChanged);
  latest.current = onChanged;

  useEffect(() => {
    if (!client) return;
    const stop = client.onNotify(scope, () => {
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        latest.current();
      }, NUDGE_WINDOW_MS);
    });
    return () => {
      stop();
      if (pending.current) {
        // Dropped rather than left to fire: the component that wanted the
        // refetch is gone, and a timer that outlives it is a state update into
        // nothing.
        clearTimeout(pending.current);
        pending.current = null;
      }
    };
  }, [client, scope]);
}
