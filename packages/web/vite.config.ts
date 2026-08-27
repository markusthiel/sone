import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The version this bundle was built from, baked in at build time.
 *
 * Not the same thing as the server's version, and the difference is the point.
 * A browser holding a cached bundle from an older deployment reports the
 * server's version if asked over HTTP, so "which version am I running?" gets a
 * misleadingly reassuring answer — while the actual JavaScript executing is
 * older. Comparing the two catches that.
 */
function buildVersion(): { version: string; commit: string } {
  const version =
    process.env['SONE_VERSION'] ??
    (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version: string;
    }).version;

  let commit = process.env['SONE_COMMIT'] ?? '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {
      // Not a git checkout — a tarball build, for instance. Unknown is honest.
      commit = 'unknown';
    }
  }

  return { version, commit: commit.slice(0, 12) };
}

const build = buildVersion();

export default defineConfig({
  plugins: [react()],
  define: {
    __SONE_WEB_VERSION__: JSON.stringify(build.version),
    __SONE_WEB_COMMIT__: JSON.stringify(build.commit),
  },
  server: {
    port: 5173,
    // The dev server proxies to the API so the browser sees one origin. Without
    // this the session cookie is cross-site and SameSite=Lax drops it, which
    // looks exactly like a broken login.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/sync': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
