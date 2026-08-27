/**
 * SONE — minimal HTTP router.
 *
 * No framework. The REST surface here is small — auth, pages, search, share
 * links — because everything about document editing goes over the WebSocket.
 * A router this size is about a hundred lines and no dependencies, which is
 * where ADR-0004 wants the dependency count.
 *
 * Revisit if the REST surface grows past roughly thirty routes: at that point
 * body parsing, validation and content negotiation start being real work and a
 * framework earns its place.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export type Handler = (ctx: RequestContext) => Promise<void> | void;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  /** Path parameters from the route pattern, e.g. :id */
  params: Record<string, string>;
  url: URL;
  /** Parsed JSON body, or null. Populated only when readJson is called. */
  json<T = unknown>(): Promise<T>;
  send(status: number, body: unknown): void;
  sendEmpty(status: number): void;
  /** Machine-readable error. Never a translated sentence (ADR-0011). */
  fail(status: number, code: string, params?: Record<string, unknown>): void;
}

interface Route {
  method: string;
  /** Segments; a segment starting with ':' is a parameter. */
  segments: string[];
  handler: Handler;
}

/** Largest accepted request body. Beyond this the request is refused unread. */
export const MAX_BODY_BYTES = 1024 * 1024;

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split('/').filter((s) => s !== ''),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }
  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }
  patch(pattern: string, handler: Handler): this {
    return this.add('PATCH', pattern, handler);
  }
  delete(pattern: string, handler: Handler): this {
    return this.add('DELETE', pattern, handler);
  }
  /**
   * PUT, for an idempotent set-to-this-state.
   *
   * Distinct from POST on purpose: favouriting a page twice must be the same as
   * doing it once, and PUT is the method that says so. A POST that quietly
   * behaves idempotently reads as a bug the first time someone retries a
   * request.
   */
  put(pattern: string, handler: Handler): this {
    return this.add('PUT', pattern, handler);
  }

  /**
   * Resolve and run a request.
   *
   * Returns false when nothing matched, so the caller can fall through to
   * static files or another handler rather than this router deciding to 404.
   */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    baseUrl: string,
  ): Promise<boolean> {
    const url = new URL(req.url ?? '/', baseUrl);
    const segments = url.pathname.split('/').filter((s) => s !== '');
    const method = (req.method ?? 'GET').toUpperCase();

    // Track whether the path matched under a different method, so a wrong
    // method gets 405 rather than a misleading 404.
    let pathMatched = false;

    for (const route of this.routes) {
      if (route.segments.length !== segments.length) continue;

      const params: Record<string, string> = {};
      let matches = true;
      for (let i = 0; i < route.segments.length; i++) {
        const pattern = route.segments[i]!;
        const actual = segments[i]!;
        if (pattern.startsWith(':')) {
          params[pattern.slice(1)] = decodeURIComponent(actual);
        } else if (pattern !== actual) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;

      pathMatched = true;
      if (route.method !== method) continue;

      const ctx = makeContext(req, res, params, url);
      try {
        await route.handler(ctx);
      } catch (err) {
        if (!res.headersSent) {
          // Detail goes to the log, never to the client: an internal error
          // message is a fingerprinting gift.
          console.error(`[http] ${method} ${url.pathname} failed`, err);
          ctx.fail(500, 'internal');
        }
      }
      return true;
    }

    if (pathMatched) {
      const ctx = makeContext(req, res, {}, url);
      ctx.fail(405, 'method_not_allowed');
      return true;
    }
    return false;
  }
}

function makeContext(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  url: URL,
): RequestContext {
  const send = (status: number, body: unknown): void => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      // Nothing this API returns is cacheable, and several responses depend on
      // credentials.
      'cache-control': 'no-store',
    });
    res.end(payload);
  };

  return {
    req,
    res,
    params,
    url,
    json: <T>() => readJson<T>(req),
    send,
    sendEmpty: (status) => {
      res.writeHead(status, { 'cache-control': 'no-store' });
      res.end();
    },
    fail: (status, code, extra) => send(status, { error: code, ...(extra ?? {}) }),
  };
}

export class BodyError extends Error {
  constructor(
    message: string,
    readonly code: 'body_too_large' | 'invalid_json',
  ) {
    super(message);
    this.name = 'BodyError';
  }
}

/**
 * Read and parse a JSON body.
 *
 * Enforces the size limit while reading rather than after: a client that
 * announces a small body and then streams a gigabyte must be cut off, not
 * buffered.
 */
export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new BodyError('body too large', 'body_too_large');
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.byteLength;
    if (total > MAX_BODY_BYTES) {
      throw new BodyError('body too large', 'body_too_large');
    }
    chunks.push(buf);
  }

  if (total === 0) return {} as T;

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new BodyError('invalid JSON', 'invalid_json');
  }
}
