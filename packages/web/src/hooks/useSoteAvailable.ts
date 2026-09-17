/**
 * SONE web — whether this instance has a SOTE server at all.
 *
 * The SOTE blocks (ADR-0188, and the integration itself in
 * `docs/sote-integration.md`) are only worth offering once an administrator
 * has registered a SOTE server: without one, a "SOTE task list" in the `/`
 * menu is a block that cannot work, and inserting it shows a box asking for a
 * connection that nobody can make. So the `/` menu asks here before it offers
 * them.
 *
 * One request per page load, shared by every editor on the page, and a
 * remembered answer that starts as "no". Starting as "no" means the entries
 * are absent for the few hundred milliseconds before the answer arrives rather
 * than present and then vanishing — a menu whose rows disappear while you read
 * it is worse than one that gains a row.
 *
 * The status route requires a session. A 401 — somebody looking at a public
 * share — is "no" as well, which is right: a share cannot edit, so the menu
 * never opens there anyway.
 */

import { useEffect, useState } from 'react';

let known: boolean | null = null;
let pending: Promise<boolean> | null = null;
const listeners = new Set<(available: boolean) => void>();

async function ask(): Promise<boolean> {
  try {
    const res = await fetch('/api/integrations/sote');
    if (!res.ok) return false;
    const status = (await res.json()) as { server?: { id: string } | null };
    return status.server != null;
  } catch {
    return false;
  }
}

/** The last answer, synchronously — for a predicate that cannot await. */
export function soteAvailableNow(): boolean {
  if (known === null && pending === null) void soteAvailable();
  return known === true;
}

/** Ask once; later calls share the same answer. */
export function soteAvailable(): Promise<boolean> {
  if (known !== null) return Promise.resolve(known);
  pending ??= ask().then((answer) => {
    known = answer;
    pending = null;
    for (const listener of listeners) listener(answer);
    return answer;
  });
  return pending;
}

/** Forget the answer — after the administrator changed the server. */
export function forgetSoteAvailability(): void {
  known = null;
}

export function useSoteAvailable(): boolean {
  const [available, setAvailable] = useState<boolean>(() => known === true);
  useEffect(() => {
    listeners.add(setAvailable);
    void soteAvailable().then(setAvailable);
    return () => {
      listeners.delete(setAvailable);
    };
  }, []);
  return available;
}
