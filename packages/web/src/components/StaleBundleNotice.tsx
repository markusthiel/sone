/**
 * SONE web — "this browser is running an older build".
 *
 * The check existed and was shown in one place: Settings → About, which is the
 * last place anybody looks. Three separate debugging rounds have now been spent
 * on the question "is the browser actually running the code we are talking
 * about", and each time the answer was in a screenshot of an asset hash rather
 * than in the application.
 *
 * So it says so where it cannot be missed, once, with the one action that fixes
 * it. Compared on the commit rather than the version string, because two builds
 * of the same `-dev` version are routine and only the commit tells them apart
 * (see buildInfo.ts).
 *
 * Deliberately not automatic. Reloading somebody's page under them loses a
 * half-typed paragraph, and an editor that reloads itself is worse than one
 * running yesterday's code.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { api } from '../api/client.ts';
import { isStaleBundle } from '../buildInfo.ts';

export function StaleBundleNotice(): ReactElement | null {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .version()
      .then((info) => {
        if (!cancelled) setStale(isStaleBundle(info.commit));
      })
      // Silent on failure: the version endpoint being unreachable is a
      // connection problem, which the status in the topbar already reports. A
      // second complaint about the same thing is noise.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stale || dismissed) return null;

  return (
    <p className="stale-bundle" role="status">
      <span>
        This browser is running an older build than the server. Reload to pick it
        up — until then, what you see may not match what the server does.
      </span>
      <button type="button" className="btn" onClick={() => window.location.reload()}>
        Reload
      </button>
      <button type="button" className="link-button" onClick={() => setDismissed(true)}>
        Not now
      </button>
    </p>
  );
}
