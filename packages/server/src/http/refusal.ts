/**
 * SONE — refusing to serve, visibly.
 *
 * When the version fence refuses a start, the server used to exit. Nothing then
 * answered on the port, so the browser showed a blank page and the container
 * restart-looped, writing the same paragraph to a log nobody was watching. The
 * reason was perfectly clear and in the one place the person affected was not
 * looking.
 *
 * So a refused start now serves. Every route answers 503 with what is wrong and
 * what to do about it: an HTML page for a browser, JSON for the API, and a
 * /health that reports unhealthy so a container orchestrator sees it too.
 *
 * Nothing else runs. No sync, no database writes, no migrations beyond the ones
 * already applied. This is a sign on the door, not a degraded mode — the whole
 * point of the fence is that running would be unsafe.
 */

import { createServer, type Server } from 'node:http';

export interface RefusalDetails {
  /** What the fence said. Shown verbatim: it is the accurate part. */
  message: string;
  code: string;
  runningVersion: string;
  /** What the database was last used by, when known. */
  previousVersion: string | null;
}

/** Escaped for HTML, since the version strings come from the database. */
function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(details: RefusalDetails): string {
  const allowDowngrade = details.code === 'downgrade';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SONE cannot start</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 2rem 1.25rem;
    font: 16px/1.6 ui-sans-serif, system-ui, sans-serif;
    display: flex; justify-content: center;
  }
  main { max-inline-size: 44rem; }
  h1 { font-size: 1.4rem; margin: 0 0 1rem; }
  p { margin: 0 0 1rem; }
  code, pre {
    font-family: ui-monospace, monospace; font-size: 0.9em;
  }
  pre {
    padding: 0.75rem 1rem; overflow-x: auto;
    border-radius: 6px; background: rgb(127 127 127 / 12%);
  }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; margin: 0 0 1.5rem; }
  dt { font-weight: 600; }
  dd { margin: 0; }
  .quiet { opacity: 0.75; font-size: 0.9em; }
</style>
</head>
<body>
<main>
  <h1>SONE cannot start safely</h1>

  <p>Your data has not been touched. The server checked itself against the
  database before doing anything and stopped, which is what it is supposed to
  do.</p>

  <dl>
    <dt>This build</dt><dd><code>${escape(details.runningVersion)}</code></dd>
    ${
      details.previousVersion
        ? `<dt>Database last used by</dt><dd><code>${escape(details.previousVersion)}</code></dd>`
        : ''
    }
    <dt>Reason</dt><dd><code>${escape(details.code)}</code></dd>
  </dl>

  <p>${escape(details.message)}</p>

  ${
    allowDowngrade
      ? `<p>If the version numbers are misleading rather than the code being older
         — which has happened when SONE's own build numbering was wrong — start
         once with:</p>
         <pre>SONE_ALLOW_DOWNGRADE=true</pre>
         <p class="quiet">Remove it again afterwards. The document format check
         still applies and cannot be bypassed.</p>`
      : `<p>Deploy the newer build again, or restore a backup taken before the
         upgrade.</p>`
  }

  <p class="quiet">This page is served by SONE itself. Nothing else is
  running: no editing, no sync, no writes.</p>
</main>
</body>
</html>
`;
}

/**
 * Serve the refusal on `port`.
 *
 * Returns the server so a caller can close it; it otherwise runs until the
 * process is stopped, which is deliberate. Exiting is what produced the restart
 * loop and the blank page.
 */
export function serveRefusal(port: number, details: RefusalDetails): Server {
  const body = page(details);

  const json = JSON.stringify({
    error: 'version_fence',
    code: details.code,
    message: details.message,
    runningVersion: details.runningVersion,
    previousVersion: details.previousVersion,
  });

  const server = createServer((req, res) => {
    const url = req.url ?? '/';

    // Health first, and unhealthy — so a container orchestrator reports this
    // rather than treating a server that answers as a server that works.
    if (url === '/health' || url.startsWith('/health?')) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(json);
      return;
    }

    if (url.startsWith('/api/') || url.startsWith('/sync')) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(json);
      return;
    }

    // Everything else gets the page, including asset paths: a client that
    // loaded before the restart would otherwise fetch a script and receive
    // HTML with a 200, which fails in a far more confusing way.
    res.writeHead(503, {
      'content-type': 'text/html; charset=utf-8',
      // Never cached. The next start should be able to work.
      'cache-control': 'no-store',
    });
    res.end(body);
  });

  server.listen(port);
  return server;
}
