/**
 * SONE web — exporting a whole workspace (ADR-0044).
 *
 * A button, and a list of what has been asked for. The archive is packed by a
 * job, so this screen watches rather than waits: an export of a large workspace
 * takes minutes, and a spinner somebody has to keep a tab open for is a request
 * they cannot walk away from.
 *
 * Polled while anything is running, and not otherwise. A page that keeps asking
 * a server about jobs that finished yesterday is a page that costs something to
 * leave open.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { readableSize } from '@sone/core';

import { api, ApiError } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { useInstance } from './Instance.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';

interface JobRow {
  id: string;
  kind: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  progress: string | null;
  error: string | null;
  bytes: number | null;
  pages: number | null;
  createdAt: string;
  expiresAt: string | null;
}

export function WorkspaceExport({ workspaceId }: { workspaceId: string }): ReactElement {
  const { t } = useT();
  const { canSendMail } = useInstance();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [attachments, setAttachments] = useState(true);

  const load = useCallback(async (): Promise<JobRow[]> => {
    const result = await api.jobs(workspaceId);
    setJobs(result.jobs as JobRow[]);
    return result.jobs as JobRow[];
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      try {
        const rows = await load();
        if (cancelled) return;
        // Again only while something is happening. The interval is the same
        // whether one job or five are running: the answer is one row each way.
        if (rows.some((job) => job.state === 'queued' || job.state === 'running')) {
          timer = setTimeout(() => void tick(), 2000);
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  return (
    <section className="settings-section">
      <h2>{t('workspace.export')}</h2>
      <p className="muted">{t('workspace.export.hint')}</p>

      {error && <p className="error">{t(`error.${error}` as MessageKey)}</p>}

      <label className="checkbox">
        <input
          type="checkbox"
          checked={attachments}
          onChange={(event) => setAttachments(event.target.checked)}
        />
        {t('export.withAttachments')}
      </label>

      <button
        type="button"
        className="btn primary"
        disabled={asking}
        onClick={() => {
          setAsking(true);
          setError(null);
          void api
            .startWorkspaceExport(workspaceId, attachments)
            .then(() => load())
            .catch((err: unknown) =>
              setError(err instanceof ApiError ? err.code : 'network_error'),
            )
            .finally(() => setAsking(false));
        }}
      >
        {t('workspace.export.start')}
      </button>

      {/* What an export contains, said before it is asked for rather than
        * discovered afterwards (ADR-0044): the job runs with the rights of
        * whoever asked, as they are when it runs. So an archive can hold less
        * than somebody expected and never more. */}
      <p className="settings-note">{t('workspace.export.rights')}</p>

      {/* Said only where it is true (ADR-0139).
        *
        * An export takes minutes and this screen only polls while somebody is
        * watching it, so the useful thing to know is that the tab can be
        * closed. ADR-0138 left it unsaid, on the belief that the interface had
        * no way to know whether this instance sends mail — it has had one all
        * along, and two other screens were already using it. */}
      {canSendMail && <p className="settings-note">{t('workspace.export.willMail')}</p>}

      {jobs && jobs.length > 0 && (
        <ul className="job-list">
          {jobs.map((job) => (
            <li key={job.id} data-state={job.state}>
              <span className="job-when">{new Date(job.createdAt).toLocaleString()}</span>

              {job.state === 'done' && (
                <>
                  <span className="job-detail">
                    {t('workspace.export.ready', {
                      pages: job.pages ?? 0,
                      size: job.bytes === null ? '' : readableSize(job.bytes),
                    })}
                  </span>
                  {/* A link, not a fetch: the response is a file with a
                      Content-Disposition and the browser knows what to do with
                      it. And when it has expired the download says so — which
                      is why the link stays rather than disappearing. */}
                  <a className="btn" href={`/api/jobs/${job.id}/download`}>
                    {t('export.download')}
                  </a>
                  {job.expiresAt && (
                    <span className="job-detail muted">
                      {t('workspace.export.until', {
                        when: new Date(job.expiresAt).toLocaleString(),
                      })}
                    </span>
                  )}
                </>
              )}

              {(job.state === 'queued' || job.state === 'running') && (
                <span className="job-detail">
                  {/* The job's own sentence when it has one, and "waiting"
                      otherwise. Not a percentage: a job that does not know how
                      much is left cannot honestly report a fraction. */}
                  {job.progress ?? t('workspace.export.waiting')}
                </span>
              )}

              {job.state === 'failed' && (
                <span className="job-detail error">
                  {job.error ?? t('workspace.export.failed')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
