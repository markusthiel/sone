/**
 * SONE — static file serving.
 *
 * The built web client is served by the same process as the API, so a
 * deployment is one container plus Postgres. A separate nginx would be another
 * moving part for the operator and another place for the two to disagree about
 * routing.
 *
 * Two things this has to get right, and both are easy to get wrong:
 *
 * **Cache headers.** Vite emits content-hashed asset filenames, so those are
 * immutable and can be cached for a year. `index.html` must never be cached, or
 * a browser keeps loading the old HTML after an upgrade and requests asset
 * hashes that no longer exist — which presents as a blank page that a hard
 * refresh fixes, the most confusing possible upgrade failure.
 *
 * **Path traversal.** A request for `/../../etc/passwd` must not escape the
 * root. Resolved and checked against the root prefix rather than filtered,
 * because filtering `..` misses encodings.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export interface StaticOptions {
  /** Directory containing the built client. */
  root: string;
  /**
   * Paths served by the API. A request under one of these is never answered
   * with index.html, so a mistyped API path returns a JSON 404 rather than the
   * app shell — which would otherwise look to a client like a successful
   * request returning nonsense.
   */
  apiPrefixes?: string[];
}

export interface StaticHandler {
  (req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  readonly available: boolean;
}

/**
 * Create a static handler, or a no-op one if the client was not built.
 *
 * A missing build is reported once at startup rather than as a 500 per request:
 * running the server without the client is a legitimate development setup, with
 * Vite serving the frontend on its own port.
 */
export async function createStaticHandler(
  opts: StaticOptions,
  log: (msg: string) => void = console.log,
): Promise<StaticHandler> {
  const root = path.resolve(opts.root);
  const apiPrefixes = opts.apiPrefixes ?? ['/api', '/sync'];

  const indexPath = path.join(root, 'index.html');
  const hasIndex = await stat(indexPath)
    .then((s) => s.isFile())
    .catch(() => false);

  if (!hasIndex) {
    log(
      `no web client at ${root} — serving the API only. ` +
        `Run 'pnpm --filter @sone/web build', or use the Vite dev server.`,
    );
    const noop = (async () => false) as unknown as StaticHandler;
    Object.defineProperty(noop, 'available', { value: false });
    return noop;
  }

  log(`serving web client from ${root}`);

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return false;

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      // A malformed percent-encoding cannot address a file.
      return false;
    }

    if (apiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return false;
    }

    // Resolve, then verify the result is still inside the root. Checking the
    // resolved path is what makes traversal impossible; filtering '..' out of
    // the input is not, because encodings slip past it.
    const candidate = path.resolve(root, `.${pathname}`);
    const insideRoot = candidate === root || candidate.startsWith(root + path.sep);

    if (insideRoot) {
      const info = await stat(candidate).catch(() => null);
      if (info?.isFile()) {
        await send(req, res, candidate, cacheControlFor(pathname));
        return true;
      }
    }

    // Anything else is a client-side route (ADR-0016), so the app shell
    // answers and the router decides. Status 200, not 404: the URL is valid,
    // the server simply does not resolve it.
    await send(req, res, indexPath, 'no-cache');
    return true;
  };

  Object.defineProperty(handler, 'available', { value: true });
  return handler as StaticHandler;
}

/**
 * Cache policy.
 *
 * Vite's hashed filenames are immutable by construction, so a long max-age is
 * safe and makes repeat visits free. `index.html` and the service worker must
 * revalidate every time, or an upgrade leaves browsers requesting asset hashes
 * that no longer exist.
 */
function cacheControlFor(pathname: string): string {
  if (/\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(pathname)) {
    return 'public, max-age=31536000, immutable';
  }
  if (pathname === '/index.html' || pathname === '/sw.js') return 'no-cache';
  return 'public, max-age=3600';
}

async function send(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  cacheControl: string,
): Promise<void> {
  const info = await stat(filePath);
  const contentType =
    MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';

  // Weak validator from size and mtime. Enough for a conditional request, and
  // avoids hashing every file on every response.
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': cacheControl });
    res.end();
    return;
  }

  res.writeHead(200, {
    'content-type': contentType,
    'content-length': info.size,
    'cache-control': cacheControl,
    etag,
    // The client is same-origin only; there is no reason for another site to
    // frame it or sniff its content type.
    'x-content-type-options': 'nosniff',
  });

  if ((req.method ?? 'GET').toUpperCase() === 'HEAD') {
    res.end();
    return;
  }

  try {
    await pipeline(createReadStream(filePath), res);
  } catch {
    // A client that disconnects mid-response is normal, not an error worth
    // logging on every navigation.
  }
}
