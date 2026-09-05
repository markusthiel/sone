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

import { useEffect, useState, type ReactElement } from 'react';

import { ApiError, api } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';
import { messageFor } from './Auth.tsx';
import { paths } from '../routes/paths.ts';

type Shares = Awaited<ReturnType<typeof api.shares>>;

const EMPTY: Shares = { links: [], granted: [], received: [] };

export function SharesScreen({ workspaceId }: { workspaceId: string }): ReactElement {
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

  return (
    <section className="settings-section shares">
      <h1 className="settings-heading">{t('shares.title')}</h1>
      <p className="muted">{t('shares.note')}</p>

      {error && <p className="error">{messageFor(error)}</p>}

      <h2 className="settings-heading">{t('shares.links')}</h2>
      <p className="muted">{t('shares.links.note')}</p>
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

      <h2 className="settings-heading">{t('shares.granted')}</h2>
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
              * Withdrawing needs the subject's id, and this list carries names:
              * a group and a person can share one, and undoing the wrong one is
              * not a mistake worth making possible. The page's own dialog has
              * the ids and the context; this list says where to go. */}
            <a className="btn" href={paths.page(grant.pageId)}>
              {t('shares.open')}
            </a>
          </li>
        ))}
      </ul>

      <h2 className="settings-heading">{t('shares.received')}</h2>
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
    </section>
  );
}
