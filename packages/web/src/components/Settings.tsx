/**
 * SONE web — settings.
 *
 * Currently only the About section, which exists to answer one question that
 * came up on the first real deployment: which version is actually running?
 *
 * Two versions are shown, not one, and the distinction is the useful part. The
 * server's version comes over HTTP; the client's is baked into the bundle at
 * build time. A browser holding a cached bundle from an earlier deployment
 * reports the server's version if only asked over HTTP — a reassuring answer
 * about code that is not the code executing. When they disagree, that is said
 * plainly, because a stale bundle is the cause of bug reports nobody can
 * reproduce.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api, type SessionInfo, type VersionInfo } from '../api/client.ts';
import { WEB_COMMIT, WEB_VERSION, isStaleBundle } from '../buildInfo.ts';
import { messageFor } from './Auth.tsx';

interface SettingsProps {
  section: string;
  session: SessionInfo;
  workspaceId: string;
}

export function Settings({ section, session, workspaceId }: SettingsProps): ReactElement {
  return (
    <div className="page-body">
      <h1>Settings</h1>
      {section === 'about' ? (
        <About />
      ) : (
        <>
          <Account session={session} workspaceId={workspaceId} />
          <About />
        </>
      )}
    </div>
  );
}

function Account({
  session,
  workspaceId,
}: {
  session: SessionInfo;
  workspaceId: string;
}): ReactElement {
  const workspace = session.workspaces.find((w) => w.id === workspaceId);
  return (
    <section className="settings-section">
      <h2>Account</h2>
      <dl className="settings-list">
        <dt>Name</dt>
        <dd>{session.user.displayName || '—'}</dd>
        <dt>Email</dt>
        <dd>{session.user.email ?? '—'}</dd>
        <dt>Workspace</dt>
        <dd>
          {workspace?.name ?? '—'}
          {workspace ? ` (${workspace.role})` : ''}
        </dd>
      </dl>
    </section>
  );
}

function About(): ReactElement {
  const [server, setServer] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .version()
      .then((info) => {
        if (!cancelled) setServer(info);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stale = isStaleBundle(server?.commit);

  return (
    <section className="settings-section">
      <h2>About</h2>

      {stale && (
        <p className="settings-warning">
          This browser is running an older build than the server. Reload to pick
          up the current version — until then, what you see may not match what
          the server does.{' '}
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      )}

      <dl className="settings-list">
        <dt>Server</dt>
        <dd>
          {server ? (
            <>
              {server.version}
              <span className="muted"> · {server.commit.slice(0, 8)}</span>
            </>
          ) : error ? (
            <span className="error">{messageFor(error)}</span>
          ) : (
            <span className="muted">checking…</span>
          )}
        </dd>

        <dt>This browser</dt>
        <dd>
          {WEB_VERSION}
          <span className="muted"> · {WEB_COMMIT.slice(0, 8)}</span>
        </dd>

        {/* The contract versions, which are what actually decide whether a
            client can talk to a server and open a document. Shown because when
            an upgrade goes wrong these are the numbers that explain why
            (ADR-0013). */}
        <dt>Document format</dt>
        <dd>{server ? `v${server.documentSchema}` : <span className="muted">—</span>}</dd>

        <dt>Sync protocol</dt>
        <dd>{server ? `v${server.syncProtocol}` : <span className="muted">—</span>}</dd>
      </dl>

      <p className="muted" style={{ fontSize: '0.85rem' }}>
        SONE is free software under the AGPL-3.0. No seat limits, no feature
        gates, no enterprise edition.
      </p>
    </section>
  );
}
