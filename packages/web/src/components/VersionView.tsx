/**
 * SONE web — a page as it was (ADR-0047).
 *
 * Read-only, and it has to *look* read-only: this is the state somebody is
 * comparing against, and an editor here would invite typing into a past that
 * cannot receive it.
 *
 * Text, not a document. The server projects the version the same way the
 * materialiser does, because the client has no business decoding a document it
 * cannot edit — and because rendering it through the editor would mean mounting a
 * second ProseMirror bound to nothing.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { api, ApiError } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';

interface Version {
  id: string;
  takenAt: string;
  title: string;
  blocks: Array<{ id: string; parentId: string | null; type: string; text: string }>;
}

/** Which element a block's text belongs in. */
function elementFor(type: string): 'h1' | 'h2' | 'h3' | 'li' | 'p' {
  if (type === 'heading-1') return 'h1';
  if (type === 'heading-2') return 'h2';
  if (type === 'heading-3') return 'h3';
  if (type === 'todo' || type === 'bullet' || type === 'numbered') return 'li';
  return 'p';
}

export function VersionView({
  pageId,
  versionId,
  onClose,
}: {
  pageId: string;
  versionId: string;
  onClose: () => void;
}): ReactElement {
  const { t } = useT();
  const [version, setVersion] = useState<Version | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVersion(null);
    setError(null);
    void api
      .pageVersion(pageId, versionId)
      .then((result) => {
        if (!cancelled) setVersion(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
  }, [pageId, versionId]);

  return (
    <div className="version-view">
      {/* Said at the top, in the content, not only in the panel: somebody who
          scrolled down and came back has to be able to tell that what they are
          reading is not the page. */}
      <div className="version-bar" role="status">
        <span>
          {version
            ? t('history.viewing', { when: new Date(version.takenAt).toLocaleString() })
            : t('panel.loading')}
        </span>
        <button type="button" className="btn subtle" onClick={onClose}>
          {t('history.backToNow')}
        </button>
      </div>

      {error && <p className="muted">{t(`error.${error}` as MessageKey)}</p>}

      {version && (
        <article className="version-body">
          <h1>{version.title || t('page.untitled')}</h1>
          {version.blocks.map((block) => {
            const Element = elementFor(block.type);
            return (
              <Element key={block.id} data-type={block.type}>
                {block.text}
              </Element>
            );
          })}
          {version.blocks.length === 0 && <p className="muted">{t('history.wasEmpty')}</p>}
        </article>
      )}
    </div>
  );
}
