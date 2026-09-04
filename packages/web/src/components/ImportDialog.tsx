/**
 * SONE web — importing an archive (ADR-0044).
 *
 * Three states in one window: choose a file, read what would happen, decide.
 *
 * The middle one is the feature. An import that has created two hundred pages
 * by the time somebody notices it mangled the hierarchy is worse than no import,
 * because undoing it is two hundred deletions. So the plan is shown and nothing
 * is written until somebody presses the second button.
 *
 * The archive is uploaded twice, once for the plan and once for the import. That
 * is stated here because it looks like a mistake and is not: the alternative is
 * the server holding somebody's upload in memory between two requests, keyed by
 * a token, expiring on a timer.
 */

import { useRef, useState, type ReactElement } from 'react';

import { ApiError } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';

interface Plan {
  pages: Array<{ path: string[]; title: string; isFolder: boolean; collides: boolean }>;
  attachments: Array<{ name: string; bytes: number }>;
  skipped: Array<{ name: string; reason: string }>;
  totals: { pages: number; folders: number; attachments: number; bytes: number };
  attachmentsImported: boolean;
}

interface Result {
  created: number;
  collided: string[];
  failed: Array<{ path: string; error: string }>;
}

/** Send the archive, either to be planned or to be carried out. */
async function send<T>(url: string, file: File, filename?: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    // The bytes, not a form: the route reads a body, and multipart would mean a
    // parser on the server for a request that carries exactly one thing.
    body: file,
    headers: {
      // Left as zip whatever the file is: the server decides from the content,
      // because a content type is a claim the browser makes and a ZIP always
      // starts `PK`.
      'content-type': 'application/zip',
      // A body has no filename, and a bare Markdown upload has to become a page
      // called something.
      ...(filename ? { 'x-sone-filename': filename } : {}),
    },
    credentials: 'same-origin',
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (body as { error?: string }).error ?? 'network_error',
    );
  }
  return body as T;
}

export function ImportDialog({
  pageId,
  title,
  onClose,
  onDone,
}: {
  pageId: string;
  title: string;
  onClose: () => void;
  /** Reload the tree: the pages exist and the sidebar does not know yet. */
  onDone: () => void;
}): ReactElement {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);

  const collisions = plan?.pages.filter((page) => page.collides).length ?? 0;

  const fail = (err: unknown): void => {
    setError(err instanceof ApiError ? err.code : 'network_error');
    setBusy(false);
  };

  return (
    <div className="dialog-scrim" role="presentation" onClick={onClose}>
      <div
        className="dialog import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('import.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">{t('import.title')}</h2>
        <p className="muted">{t('import.where', { title })}</p>

        {error && <p className="error">{t(`error.${error}` as MessageKey)}</p>}

        {!plan && !result && (
          <>
            <input
              ref={fileRef}
              type="file"
              // Markdown as well as archives, and several at once: asking
              // somebody to zip a single note before SONE will read it is
              // asking them to do work on our behalf.
              /*
               * Markdown as well as archives: asking somebody to zip a single
               * note before SONE will read it is asking them to do work on our
               * behalf.
               *
               * Not `multiple` yet, deliberately. Several files means several
               * plans to look at and confirm, and this dialog shows one — the
               * attribute alone would have accepted four files and silently
               * imported the first, which is worse than not offering it.
               */
              accept=".zip,application/zip,.md,.markdown,text/markdown"
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                setFile(chosen);
                setError(null);
                if (!chosen) return;
                setBusy(true);
                // Straight to the plan: choosing the file is the request. A
                // second button between them would only ask somebody to confirm
                // that they meant the file they just picked.
                // The name travels in a header, because a POST body has none
                // and a bare Markdown upload has to become a page called
                // something.
                void send<Plan>(`/api/pages/${pageId}/import/plan`, chosen, chosen.name)
                  .then((planned) => {
                    setPlan(planned);
                    setBusy(false);
                  })
                  .catch(fail);
              }}
            />
            {busy && <p className="muted">{t('import.reading')}</p>}
          </>
        )}

        {plan && !result && (
          <>
            <p>
              {t('import.summary', {
                pages: plan.totals.pages,
                folders: plan.totals.folders,
              })}
            </p>

            {/* The tree it would create, as paths. Not a preview of each page's
                contents: what somebody checks before an import is where things
                land, and the words are the words they exported. */}
            <ul className="import-tree">
              {plan.pages.map((page) => (
                <li
                  key={page.path.join('/')}
                  data-folder={page.isFolder}
                  data-collides={page.collides}
                >
                  <span className="import-depth" aria-hidden="true">
                    {'\u00a0'.repeat((page.path.length - 1) * 2)}
                  </span>
                  {page.title}
                  {page.collides && (
                    <span className="import-note">{t('import.exists')}</span>
                  )}
                </li>
              ))}
            </ul>

            {collisions > 0 && (
              <>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={duplicate}
                    onChange={(event) => setDuplicate(event.target.checked)}
                  />
                  {t('import.duplicate', { count: collisions })}
                </label>
                {/* There is no "replace", and saying so is better than leaving
                    somebody to look for it. */}
                <p className="settings-note">{t('import.noOverwrite')}</p>
              </>
            )}

            {plan.skipped.length > 0 && (
              <details className="import-skipped">
                <summary>{t('import.skipped', { count: plan.skipped.length })}</summary>
                <ul>
                  {plan.skipped.map((one) => (
                    <li key={one.name}>{one.name}</li>
                  ))}
                </ul>
              </details>
            )}

            {plan.attachments.length > 0 && (
              <p className="settings-note">
                {plan.attachmentsImported
                  ? t('import.attachments', { count: plan.attachments.length })
                  : t('import.attachmentsNotYet', { count: plan.attachments.length })}
              </p>
            )}

            <div className="dialog-actions">
              <button
                type="button"
                className="btn primary"
                disabled={busy || !file}
                onClick={() => {
                  if (!file) return;
                  setBusy(true);
                  void send<Result>(
                    `/api/pages/${pageId}/import${duplicate ? '?collision=duplicate' : ''}`,
                    file,
                  )
                    .then((done) => {
                      setResult(done);
                      setBusy(false);
                      onDone();
                    })
                    .catch(fail);
                }}
              >
                {busy ? t('import.working') : t('import.confirm')}
              </button>
              <button type="button" className="btn subtle" onClick={onClose}>
                {t('action.cancel')}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <p>{t('import.done', { count: result.created })}</p>
            {/* What did not happen, in the same window rather than a toast that
                disappears: a list of three pages that did not arrive is the
                reason somebody would look at the archive again. */}
            {result.collided.length > 0 && (
              <p className="muted">
                {t('import.wereSkipped', { paths: result.collided.join(', ') })}
              </p>
            )}
            {result.failed.length > 0 && (
              <ul className="import-failed">
                {result.failed.map((one) => (
                  <li key={one.path}>
                    {one.path} — {one.error}
                  </li>
                ))}
              </ul>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn primary" onClick={onClose}>
                {t('action.done')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
