/**
 * SONE web — the administration screens.
 *
 * Four panels behind one question: does this account administer the instance?
 * The server answers 404 rather than 403 to anyone who does not, so the
 * interface finds out by asking for the overview and treating a failure as
 * "no". Nothing here is rendered speculatively.
 *
 * An administrator's first need is to see what is going on, so three of the
 * four are read-only. The writes are the ones that otherwise mean editing a
 * compose file and restarting a container.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import {
  ApiError,
  api,
  type AdminOverview,
  type AdminUser,
  type AdminWorkspace,
  type MaintenanceReport,
} from '../api/client.ts';
import { messageFor } from './Auth.tsx';

/** Bytes in a form a person can judge at a glance. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * Whether the caller administers the instance.
 *
 * Asked once and shared, so the navigation and the panels agree — and so a
 * 404 for a non-administrator does not appear four times in the console.
 */
export function useIsInstanceAdmin(): { isAdmin: boolean | null } {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .adminOverview()
      .then(() => {
        if (!cancelled) setIsAdmin(true);
      })
      .catch(() => {
        // Any failure means "do not show it". A network error showing the
        // section would be worse than hiding it: the panels would then fail
        // one by one with errors that look like bugs.
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { isAdmin };
}

// --- instance ---------------------------------------------------------------

export function InstancePanel(): ReactElement {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setOverview(await api.adminOverview());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (changes: Record<string, unknown>): Promise<void> => {
    setSaving(true);
    try {
      const result = await api.adminUpdateSettings(changes);
      setOverview((previous) =>
        previous
          ? {
              ...previous,
              settings: result.settings,
              settingSources: result.settingSources,
            }
          : previous,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setSaving(false);
    }
  };

  if (error) return <p className="error">{messageFor(error)}</p>;
  if (!overview) return <p className="muted">Loading…</p>;

  const { counts, settings, settingSources } = overview;

  return (
    <>
      <section className="settings-section">
        <h2>This instance</h2>
        <dl className="settings-list">
          <dt>Version</dt>
          <dd>
            {overview.version}
            <span className="muted"> · {overview.commit.slice(0, 8)}</span>
          </dd>
          <dt>Accounts</dt>
          <dd>
            {counts.users}
            {counts.admins > 0 && (
              <span className="muted">
                {' '}
                · {counts.admins} administrator{counts.admins === 1 ? '' : 's'}
              </span>
            )}
            {counts.deactivated > 0 && (
              <span className="muted"> · {counts.deactivated} deactivated</span>
            )}
          </dd>
          <dt>Workspaces</dt>
          <dd>{counts.workspaces}</dd>
          <dt>Content</dt>
          <dd>
            {counts.pages} page{counts.pages === 1 ? '' : 's'} in {counts.folders} folder
            {counts.folders === 1 ? '' : 's'}
          </dd>
          <dt>Files</dt>
          <dd>
            {counts.files} attachment{counts.files === 1 ? '' : 's'}
            {/* Distinct files, not rows: storage is content-addressed, so the
                same image on five pages is five rows and one file. */}
            <span className="muted"> · {formatBytes(counts.fileBytes)} on disk</span>
          </dd>
        </dl>
      </section>

      <section className="settings-section">
        <h2>Settings</h2>
        <p className="muted settings-note">
          These are stored in the database and take effect immediately. Anything
          needed before the database opens — the database URL, the secret key,
          the port — stays in the environment, because a server that cannot
          start cannot be configured from a screen it never shows.
        </p>

        <div className="field">
          <label htmlFor="signup-mode">Who may create an account</label>
          <select
            id="signup-mode"
            value={settings.signupMode}
            disabled={saving}
            onChange={(event) => void update({ signupMode: event.target.value })}
          >
            <option value="open">Anyone with the address</option>
            <option value="invite">Only with an invitation</option>
            <option value="closed">Nobody — no new accounts</option>
          </select>
          <SettingSource source={settingSources['signupMode']} />
        </div>

        <div className="field">
          <label htmlFor="instance-name">Instance name</label>
          <input
            id="instance-name"
            defaultValue={settings.instanceName}
            disabled={saving}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== settings.instanceName) {
                void update({ instanceName: value });
              }
            }}
          />
          <SettingSource source={settingSources['instanceName']} />
        </div>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={settings.allowWorkspaceCreation}
              disabled={saving}
              onChange={(event) =>
                void update({ allowWorkspaceCreation: event.target.checked })
              }
            />{' '}
            Members may create workspaces
          </label>
        </div>
      </section>
    </>
  );
}

/**
 * Where a setting's value came from.
 *
 * Shown because "I set this in the compose file and it is not taking effect" is
 * otherwise an afternoon: a database value silently overriding the environment
 * looks like the environment being ignored.
 */
function SettingSource({ source }: { source: string | undefined }): ReactElement | null {
  if (source !== 'database') return null;
  return (
    <span className="muted setting-source">
      Set here, overriding the environment
    </span>
  );
}

// --- accounts ---------------------------------------------------------------

export function UsersPanel(): ReactElement {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers((await api.adminUsers()).users);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const change = async (
    userId: string,
    changes: {
      isInstanceAdmin?: boolean;
      canManageWorkspaces?: boolean;
      deactivated?: boolean;
    },
  ): Promise<void> => {
    try {
      await api.adminUpdateUser(userId, changes);
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  if (error) return <p className="error">{messageFor(error)}</p>;
  if (!users) return <p className="muted">Loading…</p>;

  return (
    <section className="settings-section">
      <h2>Accounts</h2>

      <div className="admin-table">
        {users.map((user) => (
          <div className="admin-row" key={user.id} data-inactive={user.deactivatedAt !== null}>
            <div className="admin-row-main">
              <span className="admin-name">
                {user.displayName}
                {user.isSelf && <span className="muted"> · you</span>}
              </span>
              <span className="admin-meta">
                {user.email ?? 'no address'}
                {user.isGuest && ' · share-link guest'}
                {user.workspaceCount > 0 &&
                  ` · ${user.workspaceCount} workspace${user.workspaceCount === 1 ? '' : 's'}`}
                {user.deactivatedAt && ' · deactivated'}
              </span>
            </div>

            <div className="admin-row-actions">
              {!user.isGuest && (
                <label className="admin-toggle">
                  <input
                    type="checkbox"
                    checked={user.isInstanceAdmin}
                    onChange={(event) =>
                      void change(user.id, { isInstanceAdmin: event.target.checked })
                    }
                  />{' '}
                  Administrator
                </label>
              )}

              {/* The narrower right, offered separately (ADR-0027).
                *
                * Disabled for an administrator, who holds it anyway: a control
                * that cannot change anything is one somebody clicks and then
                * wonders about. The stored value is left alone, so demoting
                * them later gives back whatever was actually granted. */}
              {!user.isGuest && (
                <label className="admin-toggle">
                  <input
                    type="checkbox"
                    checked={user.isInstanceAdmin || user.canManageWorkspaces}
                    disabled={user.isInstanceAdmin}
                    onChange={(event) =>
                      void change(user.id, { canManageWorkspaces: event.target.checked })
                    }
                  />{' '}
                  Manages workspaces
                </label>
              )}

              <button
                type="button"
                className={user.deactivatedAt ? 'btn' : 'btn destructive'}
                // Deactivating yourself is never what was meant, so the control
                // is not offered rather than refused after the fact.
                disabled={user.isSelf && !user.deactivatedAt}
                onClick={() =>
                  void change(user.id, { deactivated: user.deactivatedAt === null })
                }
              >
                {user.deactivatedAt ? 'Reactivate' : 'Deactivate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="muted settings-note">
        Deactivating keeps the account and its work, and signs it out
        immediately. Accounts are never deleted from here: removing one would
        take every page it created with it, and “this person has left” is not
        “their work never happened”.
      </p>
    </section>
  );
}

// --- workspaces -------------------------------------------------------------

export function WorkspacesPanel(): ReactElement {
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .adminWorkspaces()
      .then((result) => setWorkspaces(result.workspaces))
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.code : 'network_error'),
      );
  }, []);

  if (error) return <p className="error">{messageFor(error)}</p>;
  if (!workspaces) return <p className="muted">Loading…</p>;

  return (
    <section className="settings-section">
      <h2>Workspaces</h2>

      <div className="admin-table">
        {workspaces.map((workspace) => (
          <div className="admin-row" key={workspace.id}>
            <div className="admin-row-main">
              <span className="admin-name">{workspace.name}</span>
              <span className="admin-meta">
                {workspace.owner ? `created by ${workspace.owner}` : 'no owner recorded'}
                {` · ${workspace.memberCount} member${workspace.memberCount === 1 ? '' : 's'}`}
                {` · ${workspace.pageCount} entr${workspace.pageCount === 1 ? 'y' : 'ies'}`}
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="muted settings-note">
        Sizes only. Administering the instance does not include reading what is
        in a workspace — that needs membership, which is a decision somebody
        takes rather than a button here.
      </p>
    </section>
  );
}

// --- maintenance ------------------------------------------------------------

export function MaintenancePanel(): ReactElement {
  const [report, setReport] = useState<MaintenanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [retried, setRetried] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setReport(await api.adminMaintenance());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Run the scheduled pass now.
   *
   * The same job the timer runs, not a second implementation — a separate one
   * would drift, and the difference would only show when somebody pressed this
   * expecting the scheduled behaviour.
   */
  const runNow = async (): Promise<void> => {
    setRunning(true);
    try {
      const result = await api.adminRunMaintenance();
      const recovered = Number(result.report['recoveredProjections'] ?? 0);
      const compacted = Number(result.report['compactedDocuments'] ?? 0);
      setLastRun(
        `Recovered ${recovered} projection${recovered === 1 ? '' : 's'}, ` +
          `compacted ${compacted} document${compacted === 1 ? '' : 's'}.`,
      );
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setRunning(false);
    }
  };

  /** Try one page again, ignoring its attempt count. */
  const retry = async (pageId: string): Promise<void> => {
    try {
      const result = await api.adminRetryPage(pageId);
      setRetried((previous) => ({
        ...previous,
        [pageId]: result.recovered
          ? 'Recovered'
          : `Still failing${result.error ? `: ${result.error}` : ''}`,
      }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  if (error) return <p className="error">{messageFor(error)}</p>;
  if (!report) return <p className="muted">Loading…</p>;

  const { counts } = report;
  const healthy =
    counts.orphanedPages === 0 &&
    counts.staleSearchRows === 0 &&
    counts.entriesInsidePages === 0 &&
    counts.failedMaterialisations === 0;

  return (
    <section className="settings-section">
      <h2>Maintenance</h2>

      <div className="admin-row-actions maintenance-actions">
        <button type="button" className="btn" disabled={running} onClick={() => void runNow()}>
          {running ? 'Running…' : 'Run maintenance now'}
        </button>
        {lastRun && <span className="muted">{lastRun}</span>}
      </div>
      <p className="muted settings-note">
        This pass runs on its own every few minutes. Pressing it is for when
        waiting is not acceptable — after fixing whatever made a projection
        fail, typically.
      </p>

      {/* First, and loud. Everything else in this report may be transient; an
          unwritable upload directory is certainly broken, and every image
          upload fails until somebody fixes it on the host. */}
      {report.storage.writable === false && (
        <div className="admin-alert">
          <p className="admin-alert-title">Uploads cannot be written to disk</p>
          <p className="admin-alert-detail">{report.storage.problem}</p>
          <p className="admin-alert-detail muted">
            The container runs as uid 10001 and cannot change this itself. From
            the host, as root inside the running container:
            <code>docker exec -u 0 &lt;container&gt; chown -R 10001:10001 /var/lib/sone</code>
            Then reload this page — no restart is needed.
          </p>
          <p className="admin-alert-detail muted">
            {/* Said here because the obvious command is wrong in a way that
                looks like it worked: Compose prefixes volume names with the
                project name, and `docker run -v` given a name that does not
                exist creates an empty volume and changes that instead. */}
            Address the container rather than the volume. A volume name guessed
            wrongly is created empty rather than reported missing, so the command
            appears to succeed and nothing changes.
          </p>
        </div>
      )}

      {healthy && report.storage.writable && (
        <p className="muted">Nothing to report.</p>
      )}

      <dl className="settings-list">
        <Anomaly
          label="Orphaned entries"
          count={counts.orphanedPages}
          explain="A parent that has not arrived yet. Transient during sync; a persistent count means a page whose folder was never created."
        />
        <Anomaly
          label="Entries inside pages"
          count={counts.entriesInsidePages}
          explain="Only folders may hold children. The API refuses to create these, so a count here means a client wrote one directly."
        />
        <Anomaly
          label="Stale search rows"
          count={counts.staleSearchRows}
          explain="Indexed with an older text configuration. Re-materialise the affected workspaces."
        />
        <Anomaly
          label="Failed projections"
          count={counts.failedMaterialisations}
          explain="A document the projection could not read. The page still exists and syncs; it is missing from search and from the tree."
        />
        <dt>Waiting to project</dt>
        <dd>
          {counts.pendingMaterialisations}
          {counts.pendingMaterialisations > 0 && (
            <span className="muted"> · normal while people are editing</span>
          )}
        </dd>
      </dl>

      {report.failures.length > 0 && (
        <>
          <h3 className="admin-subheading">Recent failures</h3>
          <div className="admin-table">
            {report.failures.map((failure) => (
              <div className="admin-row" key={failure.pageId}>
                <div className="admin-row-main">
                  <span className="admin-name">{failure.pageId.slice(0, 8)}</span>
                  <span className="admin-meta">
                    {failure.error ?? 'no message recorded'}
                    {retried[failure.pageId] && ` · ${retried[failure.pageId]}`}
                  </span>
                </div>
                <div className="admin-row-actions">
                  {/* Automatic retries give up after a few attempts. This is
                      the way back once the cause is fixed: it clears the
                      counter, so the scheduled retries resume too. */}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void retry(failure.pageId)}
                  >
                    Retry
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * One anomaly count, with what it means.
 *
 * The explanation is always there rather than only when the count is non-zero:
 * an administrator reading this at three in the morning should not have to
 * find out elsewhere what "orphaned" means.
 */
function Anomaly({
  label,
  count,
  explain,
}: {
  label: string;
  count: number;
  explain: string;
}): ReactElement {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <span className={count > 0 ? 'error' : undefined}>{count}</span>
        <span className="muted admin-explain"> {explain}</span>
      </dd>
    </>
  );
}
