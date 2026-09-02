/**
 * SONE web — asking for an export (ADR-0044).
 *
 * A dialog for one question, which is worth defending: "with or without
 * attachments" is the difference between an archive somebody can email and one
 * they cannot, and it is not guessable from the outside. Everything else about
 * the export is decided — Markdown, the subtree, one archive — so there is
 * nothing else to ask.
 *
 * The download itself is a navigation rather than a fetch. The response is a
 * file with a `Content-Disposition`, and the browser already knows what to do
 * with that: fetching it into memory to make a blob URL would hold the whole
 * archive twice and lose the name the server chose.
 */

import { useState, type ReactElement } from 'react';

import { useT } from '../i18n/useT.tsx';

export function ExportDialog({
  pageId,
  title,
  onClose,
}: {
  pageId: string;
  title: string;
  onClose: () => void;
}): ReactElement {
  const { t } = useT();
  const [attachments, setAttachments] = useState(true);

  return (
    // `dialog-scrim`, which is the class this application's dialogs use. I wrote
    // `dialog-backdrop`, which exists nowhere — so the window had no fixed,
    // centred wrapper and simply rendered where it stood, at the foot of the
    // menu that opened it.
    <div className="dialog-scrim" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('export.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">{t('export.title')}</h2>
        <p className="muted">{t('export.what', { title })}</p>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={attachments}
            onChange={(event) => setAttachments(event.target.checked)}
          />
          {t('export.withAttachments')}
        </label>
        <p className="settings-note">{t('export.attachmentsNote')}</p>

        <div className="dialog-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              // A navigation, so the browser saves the file under the name the
              // server sent. The session cookie travels with it like any other
              // same-origin request.
              window.location.assign(
                `/api/pages/${pageId}/export${attachments ? '' : '?attachments=false'}`,
              );
              onClose();
            }}
          >
            {t('export.download')}
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            {t('action.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
