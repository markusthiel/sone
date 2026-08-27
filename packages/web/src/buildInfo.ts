/**
 * SONE web — what this bundle was built from.
 *
 * Substituted by Vite at build time. Declared here so the rest of the app reads
 * ordinary constants rather than globals that TypeScript does not know about.
 *
 * This is deliberately separate from the server's version. A browser holding a
 * cached bundle from an earlier deployment would report the *server's* version
 * if it only asked over HTTP — a reassuring answer about code that is not the
 * code running. Comparing the two is what makes a stale bundle visible, and a
 * stale bundle is the cause of bug reports that cannot be reproduced.
 */

declare const __SONE_WEB_VERSION__: string;
declare const __SONE_WEB_COMMIT__: string;

/** Version of the client bundle currently executing. */
export const WEB_VERSION: string =
  typeof __SONE_WEB_VERSION__ === 'string' ? __SONE_WEB_VERSION__ : 'unknown';

/** Commit the client bundle was built from. */
export const WEB_COMMIT: string =
  typeof __SONE_WEB_COMMIT__ === 'string' ? __SONE_WEB_COMMIT__ : 'unknown';

/**
 * Do the client and server disagree about which version is deployed?
 *
 * Compared on the commit rather than the version string, because two builds of
 * `0.1.0-dev` are routine and only the commit distinguishes them. Unknown values
 * never count as a mismatch: a bundle built outside git should not nag.
 */
export function isStaleBundle(serverCommit: string | null | undefined): boolean {
  if (!serverCommit || serverCommit === 'unknown') return false;
  if (WEB_COMMIT === 'unknown') return false;
  // Both are shortened, and not necessarily to the same length.
  const shortest = Math.min(WEB_COMMIT.length, serverCommit.length);
  return WEB_COMMIT.slice(0, shortest) !== serverCommit.slice(0, shortest);
}
