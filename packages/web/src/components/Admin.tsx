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
import { useT } from '../i18n/useT.tsx';
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
  const { t } = useT();
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
  if (!overview) return <p className="muted">{t('admin.loading')}</p>;

  const { counts, settings, settingSources } = overview;

  return (
    <>
      <section className="settings-section">
        <h2>{t('admin.instance')}</h2>
        <dl className="settings-list">
          <dt>{t('admin.version')}</dt>
          <dd>
            {overview.version}
            <span className="muted"> · {overview.commit.slice(0, 8)}</span>
          </dd>
          <dt>{t('admin.accounts')}</dt>
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
          <dt>{t('admin.workspaces')}</dt>
          <dd>{counts.workspaces}</dd>
          <dt>{t('admin.content')}</dt>
          <dd>
            {counts.pages} page{counts.pages === 1 ? '' : 's'} in {counts.folders} folder
            {counts.folders === 1 ? '' : 's'}
          </dd>
          <dt>{t('admin.files')}</dt>
          <dd>
            {counts.files} attachment{counts.files === 1 ? '' : 's'}
            {/* Distinct files, not rows: storage is content-addressed, so the
                same image on five pages is five rows and one file. */}
            <span className="muted"> · {formatBytes(counts.fileBytes)} on disk</span>
          </dd>
        </dl>
      </section>

      <section className="settings-section">
        <h2>{t('admin.settings')}</h2>
        <p className="muted settings-note">
        {t('admin.settings.note')}
        </p>

        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('admin.signup')}</b>
              <span>
                {t('admin.signup.note')}
                <SettingSource source={settingSources['signupMode']} />
              </span>
            </span>
            <select
              id="signup-mode"
              aria-label={t('admin.signup')}
              value={settings.signupMode}
              disabled={saving}
              onChange={(event) => void update({ signupMode: event.target.value })}
            >
              <option value="open">{t('admin.signup.open')}</option>
              <option value="invite">{t('admin.signup.invite')}</option>
              <option value="closed">{t('admin.signup.closed')}</option>
            </select>
          </div>

          {/* The tone of the house (ADR-0041).
            *
            * An instance setting rather than a personal one: two members of one
            * workspace reading different forms of address in the same sentence
            * would be stranger than either choice, and it is the people running
            * the instance who know which their readers expect.
            *
            * Only visible where a language distinguishes it, which is why the
            * hint says English is unaffected rather than hiding the control on an
            * English instance — somebody setting up for German colleagues is
            * often reading English while they do it. */}
          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('admin.addressForm')}</b>
              <span>
                In German and other languages that distinguish it. English has one
                form and is unaffected.
                <SettingSource source={settingSources['addressForm']} />
              </span>
            </span>
            <select
              id="address-form"
              aria-label={t('admin.addressForm')}
              value={settings.addressForm}
              disabled={saving}
              onChange={(event) => void update({ addressForm: event.target.value })}
            >
              <option value="informal">{t('admin.addressForm.informal')}</option>
              <option value="formal">{t('admin.addressForm.formal')}</option>
            </select>
          </div>

          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('admin.instanceName')}</b>
              <span>
                {t('admin.instanceName.hint')}
                <SettingSource source={settingSources['instanceName']} />
              </span>
            </span>
            <input
              id="instance-name"
              aria-label={t('admin.instanceName')}
              defaultValue={settings.instanceName}
              disabled={saving}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== settings.instanceName) {
                  void update({ instanceName: value });
                }
              }}
            />
          </div>

          <label className="settings-row">
            <span className="settings-row-label">
              <b>{t('admin.mayCreateWorkspaces')}</b>
              <span>
                {t('admin.mayCreateWorkspaces.hint')}
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings.allowWorkspaceCreation}
              disabled={saving}
              onChange={(event) =>
                void update({ allowWorkspaceCreation: event.target.checked })
              }
            />
          </label>
        </div>
      </section>

      {/* Mail in a section of its own (ADR-0058).
        *
        * It arrived in the middle of the general settings, so six mail
        * fields read as a continuation of "who may sign up" — a heading is
        * what tells somebody where one subject ends and another begins. */}
      <section className="settings-section">
        <h2>{t('admin.mail')}</h2>
        <p className="settings-note">{t('admin.mail.hint')}</p>

          {/* Where mail goes (ADR-0058).
            *
            * Here rather than only in the environment, which is what they were:
            * the keys existed and the route accepted them, and no screen drew
            * them — so from an administrator's side they were environment-only
            * whatever the code said.
            *
            * An empty host means no email at all, and the hint says so: that is
            * a normal instance, not a broken one, and somebody should not have
            * to find that out by watching a queue. */}
          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('admin.smtpHost')}</b>
              <span>
                {t('admin.smtpHost.hint')}
                <SettingSource source={settingSources['smtpHost']} />
              </span>
            </span>
            <input
              id="smtp-host"
              aria-label={t('admin.smtpHost')}
              defaultValue={settings.smtpHost}
              disabled={saving}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value !== settings.smtpHost) void update({ smtpHost: value });
              }}
            />
          </div>

          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('admin.smtpPort')}</b>
              <span>
                {t('admin.smtpPort.hint')}
                <SettingSource source={settingSources['smtpPort']} />
              </span>
            </span>
            <input
              id="smtp-port"
              inputMode="numeric"
              aria-label={t('admin.smtpPort')}
              defaultValue={settings.smtpPort}
              disabled={saving}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value !== settings.smtpPort) void update({ smtpPort: value });
              }}
            />
          </div>

          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('admin.smtpSecurity')}</b>
              <span>
                {t('admin.smtpSecurity.hint')}
                <SettingSource source={settingSources['smtpSecurity']} />
              </span>
            </span>
            <select
              id="smtp-security"
              aria-label={t('admin.smtpSecurity')}
              value={settings.smtpSecurity}
              disabled={saving}
              onChange={(event) => void update({ smtpSecurity: event.target.value })}
            >
              <option value="starttls">STARTTLS (587)</option>
              <option value="tls">TLS (465)</option>
              <option value="none">{t('admin.smtpSecurity.none')}</option>
            </select>
          </div>

          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('admin.smtpUser')}</b>
              <span>
                {/* And where the password is, because it is the one value that
                    stays in the environment (ADR-0024): a secret in a table is
                    a secret in every backup. */}
                {t('admin.smtpUser.hint')}
                <SettingSource source={settingSources['smtpUser']} />
              </span>
            </span>
            <input
              id="smtp-user"
              autoComplete="off"
              aria-label={t('admin.smtpUser')}
              defaultValue={settings.smtpUser}
              disabled={saving}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value !== settings.smtpUser) void update({ smtpUser: value });
              }}
            />
          </div>

          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('admin.smtpFrom')}</b>
              <span>
                {t('admin.smtpFrom.hint')}
                <SettingSource source={settingSources['smtpFrom']} />
              </span>
            </span>
            <input
              id="smtp-from"
              aria-label={t('admin.smtpFrom')}
              defaultValue={settings.smtpFrom}
              disabled={saving}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value !== settings.smtpFrom) void update({ smtpFrom: value });
              }}
            />
          </div>

          <div className="settings-row">
            <span className="settings-row-label">
              <b>{t('admin.emailDetail')}</b>
              <span>
                {t('admin.emailDetail.hint')}
                <SettingSource source={settingSources['emailDetail']} />
              </span>
            </span>
            <select
              id="email-detail"
              aria-label={t('admin.emailDetail')}
              value={settings.emailDetail}
              disabled={saving}
              onChange={(event) => void update({ emailDetail: event.target.value })}
            >
              <option value="title">{t('admin.emailDetail.title')}</option>
              <option value="workspace">{t('admin.emailDetail.workspace')}</option>
            </select>
          </div>


        {/* `admin-subheading`, which this screen already has for the failure
            list below — `settings-subheading` was a second name I invented for
            a thing that exists. */}
        <h3 className="admin-subheading">{t('admin.replies')}</h3>
        <p className="settings-note">{t('admin.replies.hint')}</p>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('admin.imapHost')}</b>
            <span>
              {t('admin.imapHost.hint')}
              <SettingSource source={settingSources['imapHost']} />
            </span>
          </span>
          <input
            id="imap-host"
            aria-label={t('admin.imapHost')}
            defaultValue={settings.imapHost}
            disabled={saving}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value !== settings.imapHost) void update({ imapHost: value });
            }}
          />
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('admin.imapPort')}</b>
            <span>
              {t('admin.imapPort.hint')}
              <SettingSource source={settingSources['imapPort']} />
            </span>
          </span>
          <input
            id="imap-port"
            inputMode="numeric"
            aria-label={t('admin.imapPort')}
            defaultValue={settings.imapPort}
            disabled={saving}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value !== settings.imapPort) void update({ imapPort: value });
            }}
          />
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('admin.imapUser')}</b>
            <span>
              {t('admin.imapUser.hint')}
              <SettingSource source={settingSources['imapUser']} />
            </span>
          </span>
          <input
            id="imap-user"
            autoComplete="off"
            aria-label={t('admin.imapUser')}
            defaultValue={settings.imapUser}
            disabled={saving}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value !== settings.imapUser) void update({ imapUser: value });
            }}
          />
        </div>

        <div className="settings-row">
          <span className="settings-row-label">
            <b>{t('admin.replyMailbox')}</b>
            <span>
              {t('admin.replyMailbox.hint')}
              <SettingSource source={settingSources['replyMailbox']} />
            </span>
          </span>
          <input
            id="reply-mailbox"
            aria-label={t('admin.replyMailbox')}
            defaultValue={settings.replyMailbox}
            disabled={saving}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value !== settings.replyMailbox) void update({ replyMailbox: value });
            }}
          />
        </div>

        <MailTest />
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
/**
 * Send one test mail, and say what came back (ADR-0058).
 *
 * The relay's own words, not a paraphrase: "535 authentication failed" is the
 * answer, and "sending failed" is a sentence that costs somebody an hour. It
 * goes to the administrator's own address — a field for an arbitrary one would
 * make the instance an open relay with a sign-in.
 */
function MailTest(): ReactElement {
  const { t } = useT();
  type Using = NonNullable<Awaited<ReturnType<typeof api.testMail>>['using']>;
  const [state, setState] = useState<
    | { kind: 'idle' | 'sending' }
    | { kind: 'sent'; to: string }
    | { kind: 'failed'; why: string; using?: Using }
  >({ kind: 'idle' });

  return (
    <div className="settings-actions mail-test">
      <button
        type="button"
        className="btn subtle"
        disabled={state.kind === 'sending'}
        onClick={() => {
          setState({ kind: 'sending' });
          void api
            .testMail()
            .then((result) => {
              // Spread rather than assigned: `exactOptionalPropertyTypes`
              // distinguishes an absent key from one holding undefined, and a
              // failure with no diagnostics should be the first.
              setState(
                result.sentTo
                  ? { kind: 'sent', to: result.sentTo }
                  : {
                      kind: 'failed',
                      why: result.problem ?? '',
                      ...(result.using ? { using: result.using } : {}),
                    },
              );
            })
            .catch((err: unknown) => {
              setState({
                kind: 'failed',
                why: err instanceof ApiError ? messageFor(err.code) : 'network_error',
              });
            });
        }}
      >
        {state.kind === 'sending' ? t('admin.mail.testing') : t('admin.mail.test')}
      </button>

      {state.kind === 'sent' && (
        <p className="settings-note">{t('admin.mail.testSent', { address: state.to })}</p>
      )}
      {state.kind === 'failed' && (
        <p className="error">
          {t('admin.mail.testFailed')}
          {/* The relay's text, in a monospaced face: it is a machine's answer
              and reads as one, and somebody is going to paste it into a
              search. */}
          <code className="mail-test-reason">{state.why}</code>
        </p>
      )}

      {/* What the server used, when it failed (ADR-0058).
        *
        * A 535 means "these credentials are wrong", and an operator cannot see
        * inside the container to find out which ones arrived. Never the
        * password — its length, and whether it came wrapped in quotes or padded
        * with spaces, which is the difference between a typo and compose
        * passing the quotes along. */}
      {state.kind === 'failed' && state.using && (
        <dl className="mail-test-using">
          <dt>{t('admin.mail.using')}</dt>
          <dd>
            <code>
              {state.using.user || '(no user)'} @ {state.using.host}:{state.using.port} ·{' '}
              {state.using.security} · from {state.using.from}
            </code>
          </dd>
          <dt>{t('admin.mail.usingPassword')}</dt>
          <dd>
            {state.using.passwordMissing
              ? t('admin.mail.passwordMissing')
              : t('admin.mail.passwordLength', { count: state.using.passwordLength })}
            {state.using.passwordLooksQuoted && ` · ${t('admin.mail.passwordQuoted')}`}
            {state.using.passwordHasEdgeSpace && ` · ${t('admin.mail.passwordSpace')}`}
          </dd>
        </dl>
      )}
    </div>
  );
}

function SettingSource({ source }: { source: string | undefined }): ReactElement | null {
  const { t } = useT();
  if (source !== 'database') return null;
  return (
    <span className="muted setting-source">
      {t('admin.settingSource.database')}
    </span>
  );
}

// --- accounts ---------------------------------------------------------------

export function UsersPanel(): ReactElement {
  const { t } = useT();
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
  if (!users) return <p className="muted">{t('admin.loading')}</p>;

  return (
    <section className="settings-section">
      <h2>{t('admin.accounts')}</h2>

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
        {t('admin.accounts.note')}
      </p>
    </section>
  );
}

// --- workspaces -------------------------------------------------------------

export function WorkspacesPanel(): ReactElement {
  const { t } = useT();
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
  if (!workspaces) return <p className="muted">{t('admin.loading')}</p>;

  return (
    <section className="settings-section">
      <h2>{t('admin.workspaces')}</h2>

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
        {t('admin.sizesOnly')}
      </p>
    </section>
  );
}

// --- maintenance ------------------------------------------------------------

export function MaintenancePanel(): ReactElement {
  const { t } = useT();
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
  if (!report) return <p className="muted">{t('admin.loading')}</p>;

  const { counts } = report;
  const healthy =
    counts.orphanedPages === 0 &&
    counts.staleSearchRows === 0 &&
    counts.entriesInsidePages === 0 &&
    counts.failedMaterialisations === 0 &&
    // A wrong SMTP password belongs in the all-clear too: a panel that says
    // "nothing is wrong" while mail is failing teaches an operator not to read
    // it (ADR-0058).
    (counts.failedMail ?? 0) === 0 &&
    // A lowered password cost is not an event but a state, and this panel is
    // the answer to "is anything wrong with my instance" (ADR-0010).
    (counts.weakPasswordCost ?? 0) === 0;

  return (
    <section className="settings-section">
      <h2>{t('admin.maintenance')}</h2>

      <div className="admin-row-actions maintenance-actions">
        <button type="button" className="btn" disabled={running} onClick={() => void runNow()}>
          {running ? t('admin.maintenance.running') : t('admin.maintenance.run')}
        </button>
        {lastRun && <span className="muted">{lastRun}</span>}
      </div>
      <p className="muted settings-note">
        {t('admin.maintenance.note')}
      </p>

      {/* First, and loud. Everything else in this report may be transient; an
          unwritable upload directory is certainly broken, and every image
          upload fails until somebody fixes it on the host. */}
      {report.storage.writable === false && (
        <div className="admin-alert">
          <p className="admin-alert-title">{t('admin.uploadsUnwritable')}</p>
          <p className="admin-alert-detail">{report.storage.problem}</p>
          <p className="admin-alert-detail muted">
            {t('admin.storage.fix')}
            <code>docker exec -u 0 &lt;container&gt; chown -R 10001:10001 /var/lib/sone</code>
            {t('admin.reloadNote')}
          </p>
          <p className="admin-alert-detail muted">
            {/* Said here because the obvious command is wrong in a way that
                looks like it worked: Compose prefixes volume names with the
                project name, and `docker run -v` given a name that does not
                exist creates an empty volume and changes that instead. */}
            {t('admin.storage.volumeWarning')}
          </p>
        </div>
      )}

      {healthy && report.storage.writable && (
        <p className="muted">{t('admin.nothingToReport')}</p>
      )}

      {/* Stacked rather than two columns: each of these is a label, a count and a
          paragraph, and a paragraph in the right-hand column of a two-column
          grid is a ribbon beside a number. */}
      <dl className="settings-list explained">
        <Anomaly
          label={t('admin.anomaly.orphaned')}
          count={counts.orphanedPages}
          explain={t('admin.anomaly.orphaned.explain')}
        />
        <Anomaly
          label={t('admin.anomaly.nested')}
          count={counts.entriesInsidePages}
          explain={t('admin.anomaly.nested.explain')}
        />
        <Anomaly
          label={t('admin.anomaly.staleSearch')}
          count={counts.staleSearchRows}
          explain={t('admin.anomaly.staleSearch.explain')}
        />
        <Anomaly
          label={t('admin.anomaly.failed')}
          count={counts.failedMaterialisations}
          explain={t('admin.anomaly.failed.explain')}
        />
        {(counts.weakPasswordCost ?? 0) > 0 && (
          <>
            <dt>{t('admin.anomaly.passwordCost')}</dt>
            <dd>
              {t('admin.anomaly.passwordCost.explain', {
                cost: counts.weakPasswordCost ?? 0,
              })}
            </dd>
          </>
        )}
        <Anomaly
          label={t('admin.anomaly.mail')}
          count={counts.failedMail ?? 0}
          explain={t('admin.anomaly.mail.explain')}
        />
        <dt>{t('admin.waitingToProject')}</dt>
        <dd>
          {counts.pendingMaterialisations}
          {counts.pendingMaterialisations > 0 && (
            <span className="muted"> · normal while people are editing</span>
          )}
        </dd>
      </dl>

      {report.failures.length > 0 && (
        <>
          <h3 className="admin-subheading">{t('admin.recentFailures')}</h3>
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
                    {t('action.retry')}
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
  const { t } = useT();
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
