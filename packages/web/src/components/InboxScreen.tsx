/**
 * SONE web — the inbox (ADR-0052).
 *
 * What is waiting, across every workspace, newest first. Not an activity feed:
 * a row is here because somebody was addressed, which is the decision the whole
 * record turns on.
 *
 * Opening one marks it read — not looking at the list. An inbox that empties
 * itself because somebody glanced at it is an inbox that loses things.
 */

import { useEffect, useState, type ReactElement } from 'react';

import { api, ApiError } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';
import { paths } from '../routes/paths.ts';
import { messageFor } from './Auth.tsx';

interface Item {
  id: string;
  kind: 'mention' | 'reply' | 'assignment';
  excerpt: string;
  createdAt: string;
  read: boolean;
  pageId: string;
  pageTitle: string;
  threadId: string | null;
  workspaceId: string;
  workspaceName: string;
}

export function InboxScreen(): ReactElement {
  const { t } = useT();
  const [items, setItems] = useState<Item[] | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .inbox(unreadOnly)
      .then((result) => {
        if (!cancelled) setItems(result.notifications);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
  }, [unreadOnly]);

  return (
    <div className="page-body">
      <h1>{t('inbox.title')}</h1>

      {error && <p className="error">{messageFor(error)}</p>}

      <div className="inbox-controls">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
          />
          {t('inbox.unreadOnly')}
        </label>

        {items && items.some((one) => !one.read) && (
          <button
            type="button"
            className="btn subtle"
            onClick={() => {
              // Everything, because after a week away the list is long and
              // somebody has to be able to declare bankruptcy on it.
              void api.markInboxRead().then(() =>
                setItems((current) =>
                  (current ?? []).map((one) => ({ ...one, read: true })),
                ),
              );
            }}
          >
            {t('inbox.markAll')}
          </button>
        )}
      </div>

      {items === null && <p className="muted">{t('panel.loading')}</p>}

      {items?.length === 0 && (
        <>
          <p className="muted">{t('inbox.empty')}</p>
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
                  if (!item.read) void api.markInboxRead([item.id]);
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
