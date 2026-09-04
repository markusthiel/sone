/**
 * The notifications themselves — the content, not the menu (ADR-0069).
 *
 * The views live in the panel beside this and the list arrives already filtered,
 * which is why there is no control here any more: a filter drawn twice is a
 * filter that can disagree with itself, and the one in the panel is the one
 * that also carries the counts.
 *
 * Fetching happens above both (useInbox) for the same reason.
 */

import type { ReactElement } from 'react';

import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';
import type { InboxItem } from '../hooks/useInbox.ts';

export function InboxScreen({
  items,
  error,
  onRead,
}: {
  /** Already filtered to the panel's view. Null while the first fetch runs. */
  items: InboxItem[] | null;
  error: string | null;
  onRead: (ids?: string[]) => void;
}): ReactElement {
  const { t } = useT();

  return (
    <div className="page-body">
      <h1 className="page-title">{t('inbox.title')}</h1>

      {error && <p className="error">{messageFor(error)}</p>}

      {items === null && <p className="muted">{t('panel.loading')}</p>}

      {items?.length === 0 && (
        <>
          <p className="muted">{t('inbox.emptyView')}</p>
          {/* Said here rather than left to be assumed: nothing about this
              interface should imply an email is on its way (ADR-0052). */}
          <p className="settings-note">{t('inbox.noEmail')}</p>
        </>
      )}

      {items && items.length > 0 && (
        <ul className="inbox-list">
          {items.map((item) => (
            <li key={item.id} data-read={item.read ? 'true' : undefined}>
              <a
                href={paths.page(item.pageId, item.pageTitle)}
                onClick={() => {
                  // Read on opening, which is what "read" means here. Fired
                  // without waiting: the navigation is more important than the
                  // acknowledgement, and a mark that fails is one row that
                  // stays bold.
                  if (!item.read) onRead([item.id]);
                }}
              >
                <span className="inbox-what">
                  {t(`inbox.${item.kind}` as MessageKey)}
                </span>
                <span className="inbox-excerpt">{item.excerpt}</span>
                {/* Where it was, because an inbox spans workspaces and "which
                    page" is the first thing somebody needs to know. */}
                <span className="inbox-where">
                  {item.workspaceName} · {item.pageTitle}
                  {' · '}
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
