/**
 * SONE web — what is shared, from both ends (ADR-0026).
 *
 * Asked for as "ein Menüpunkt mit Freigaben. So dass man sieht welche Seiten
 * man selbst freigegeben hat und welche für mich freigegeben wurden. Als
 * Übersicht und Möglichkeit zu bearbeiten."
 *
 * Until now a share could only be seen **from the page**: open it, open the
 * dialog, read the list. That answers "who can see this page", and the question
 * people actually have is the other one — "what have I let out, and what am I
 * responsible for" — which is about a hundred pages and gets asked when
 * somebody leaves or a project ends. A rule nobody can enumerate is a rule
 * nobody reviews.
 *
 * ## Three lists, in this order
 *
 * **Links first.** A link is a URL in somebody's inbox: it is the only kind of
 * share that has already left the building, and the only one that can be
 * forwarded by somebody who was never given anything. The other two are people
 * who are already here.
 *
 * Then what this person gave, then what they were given. In that order because
 * the first is a responsibility and the second is a courtesy: the list you are
 * accountable for comes before the list somebody else is accountable for.
 *
 * ## Every row can be undone here
 *
 * That is the "Möglichkeit zu bearbeiten" half, and without it the screen is a
 * report. Withdrawing is the only edit offered: changing a level is a decision
 * about one page, made with that page's context in front of you, and a screen
 * that offered it would be a second place to set permissions — which is how two
 * places come to disagree.
 */

import { NotifyScope, type SoneClient } from '@sone/client';
import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api } from '../api/client.ts';
import { useNudge } from '../hooks/useNudge.ts';
import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';
import { messageFor } from './Auth.tsx';
import { paths } from '../routes/paths.ts';
import type { SharesView } from './SharesPanel.tsx';

type Shares = Awaited<ReturnType<typeof api.shares>>;

const EMPTY: Shares = { links: [], granted: [], received: [] };

export function SharesScreen({
  workspaceId,
  view,
  onCounts,
  client,
}: {
  workspaceId: string;
  /** Which of the three the menu chose (ADR-0092). */
  view: SharesView;
  /** How many are in each, so the menu can say so without asking again. */
  onCounts: (counts: Record<SharesView, number>) => void;
  /**
   * The sync connection, so a link somebody else revoked stops being offered
   * here (ADR-0098).
   *
   * This is the screen where a stale row is worst: every one of them is a
   * "withdraw" button, and withdrawing something that is already gone is a
   * refusal for an act somebody believed they were still able to make.
   */
  client?: SoneClient | null;
}): ReactElement {
  const { t } = useT();
  const [shares, setShares] = useState<Shares>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = (): void => {
    void api
      .shares(workspaceId)
      .then((result) => {
        setShares(result);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.code : 'network_error');
        setLoaded(true);
      });
  };

  useEffect(load, [workspaceId]);

  /*
   * And again when the server says a share changed (ADR-0098).
   *
   * Its own scope, not the tree's: links, grants and group membership move
   * these three lists, and a rename — which the tree cares about — cannot.
   */
  useNudge(client, NotifyScope.Shares, load);

  // The menu's numbers come from the list this screen already has. A second
  // request for them is how a count and a list come to disagree.
  useEffect(() => {
    onCounts({
      links: shares.links.length,
      granted: shares.granted.length,
      received: shares.received.length,
    });
  }, [shares, onCounts]);

  const act = (work: Promise<unknown>): void => {
    setError(null);
    void work
      .then(load)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  };

  const scope = (includeSubtree: boolean): string =>
    t(includeSubtree ? 'shares.subtree' : 'shares.onlyPage');

  const level = (access: string): string => t(`access.${access}` as MessageKey);

  if (!loaded) return <p className="muted">{t('perm.checking')}</p>;

  const nothing = (
    <li className="muted">{t('shares.nothing')}</li>
  );

  /*
   * One list at a time, chosen in the menu (ADR-0092).
   *
   * All three were stacked here with an empty sidebar beside them, which is
   * the one arrangement this shell does not have: the left column is the menu
   * and the middle is what it chose. The order the three were written in is
   * kept as the order of the menu — it was the advice, and it still is.
   */
  return (
    <section className="settings-section shares">
      <h1 className="settings-heading">{t(`shares.${view}` as MessageKey)}</h1>
      <p className="muted">{view === 'links' ? t('shares.links.note') : t('shares.note')}</p>

      {error && <p className="error">{messageFor(error)}</p>}

      {view === 'links' && (
        <ul className="permission-list">
          {shares.links.length === 0 && nothing}
          {shares.links.map((link) => (
            <li key={link.id}>
              <a href={paths.page(link.pageId)}>{link.pageTitle}</a>
              <span className="muted">
                {level(link.role)} · {scope(link.includeSubtree)}
                {link.hasPassword && ` · ${t('shares.protected')}`}
                {link.expiresAt &&
                  ` · ${t('shares.expires', {
                    date: new Date(link.expiresAt).toLocaleDateString(),
                  })}`}
                {/* Whose link it is, because a list that mixes yours with a
                    colleague's and says which is which is reviewable, and one
                    that does not is a list of surprises. */}
                {link.mine && ` · ${t('shares.mine')}`}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => act(api.revokeShareLink(link.pageId, link.id))}
              >
                {t('shares.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {view === 'granted' && (
        <ul className="permission-list">
          {shares.granted.length === 0 && nothing}
          {shares.granted.map((grant) => (
            <li key={`${grant.pageId}-${grant.subjectKind}-${grant.subject}`}>
              <a href={paths.page(grant.pageId)}>{grant.pageTitle}</a>
              <span className="muted">
                {grant.subject} · {level(grant.access)} · {scope(grant.includeSubtree)}
              </span>
              {/* No control here.
                *
                * Withdrawing needs the subject's id, and this list carries
                * names: a group and a person can share one, and undoing the
                * wrong one is not a mistake worth making possible. The page's
                * own dialog has the ids and the context; this list says where
                * to go. */}
              <a className="btn" href={paths.page(grant.pageId)}>
                {t('shares.open')}
              </a>
            </li>
          ))}
        </ul>
      )}

      {view === 'received' && (
        <ul className="permission-list">
          {shares.received.length === 0 && nothing}
          {shares.received.map((grant) => (
            <li key={`${grant.pageId}-${grant.viaGroup ?? 'self'}`}>
              <a href={paths.page(grant.pageId)}>{grant.pageTitle}</a>
              <span className="muted">
                {level(grant.access)} · {scope(grant.includeSubtree)}
                {grant.grantedBy && ` · ${t('shares.by', { name: grant.grantedBy })}`}
                {/* Why they have it, which is the question somebody asks when
                    they find a page they did not expect. */}
                {grant.viaGroup && ` · ${t('shares.viaGroup', { name: grant.viaGroup })}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
