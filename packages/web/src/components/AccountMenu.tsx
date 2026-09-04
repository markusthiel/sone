/**
 * SONE web — the face at the foot of a column, and the menu behind it.
 *
 * Extracted from the sidebar so the settings columns can carry it too. It was
 * only there, which meant that from the administration area the way to your own
 * profile was out through the notes and back in — and the switcher at the top of
 * those columns only moves between areas, not to the trash or out of the account.
 *
 * One mark rather than a row of them. Four icons in a row asked somebody to learn
 * four symbols for things they use rarely, and the row grew every time the
 * account gained a page. Behind the face there is room for names, which is what
 * these entries are actually distinguished by.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { WEB_VERSION } from '../buildInfo.ts';
import { api } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { paths } from '../routes/paths.ts';
import {
  BellIcon,
  PersonIcon,
  SettingsIcon,
  WorkspacesIcon,
  SignOutIcon,
  SlidersIcon,
  TrashIcon,
} from './icons.tsx';

interface AccountMenuProps {
  displayName: string;
  /** Whose picture. */
  userId: string;
  /** Whether to offer the way into the instance administration (ADR-0032). */
  canAdminister: boolean;

  onLogout: () => void;
}

export function AccountMenu({
  displayName,
  userId,
  canAdminister,
  onLogout,
}: AccountMenuProps): ReactElement {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  /*
   * The count, fetched here rather than passed in (ADR-0052).
   *
   * Two screens render this menu — the application and the settings shell — and
   * a prop would mean both of them fetching the same number and both being
   * responsible for keeping it fresh. The badge is the menu's own business.
   *
   * Once per mount, which is once per navigation: not polled. A number that is
   * a minute old is the right trade for a request nobody asked for.
   */
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void api
      .inboxCount()
      .then((result) => {
        if (!cancelled) setUnread(result.unread);
      })
      .catch(() => {
        // A count that cannot be fetched is drawn as no count. An error badge
        // on the account button would be a permanent complaint about something
        // nobody can act on.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Most accounts have no picture, so a failed request is the ordinary case
  // rather than an error worth reporting.
  const [avatarBroken, setAvatarBroken] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  /**
   * Closing it.
   *
   * The sidebar's copy had none of this: the menu stayed open until something
   * inside it was pressed, so it sat over the tree after a stray click. Written
   * once here, like the switcher's, rather than twice.
   */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (panel.current?.contains(event.target as Node)) return;
      if (button.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="sidebar-footer">
      <button
        ref={button}
        type="button"
        className="sidebar-account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          unread > 0
            ? t('account.label.waiting', { name: displayName, count: unread })
            : t('account.label', { name: displayName })
        }
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="sidebar-avatar" aria-hidden="true">
          {avatarBroken ? (
            displayName.trim().charAt(0).toUpperCase() || '?'
          ) : (
            <img
              src={`/api/users/${userId}/avatar`}
              alt=""
              onError={() => setAvatarBroken(true)}
            />
          )}
        </span>
        <span className="sidebar-account-name">{displayName}</span>
        {/* What is waiting (ADR-0052).
          *
          * On the button rather than beside it, because this is the one thing
          * in the interface that has to be noticed without being looked for.
          * The number is in the button's own label as well, or a screen reader
          * announces the name and not the count. */}
        {unread > 0 && (
          <span className="sidebar-unread" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <a
        className="sidebar-version"
        href={paths.settings('about')}
        title={t('account.version')}
      >
        {WEB_VERSION}
      </a>

      {open && (
        <div className="sidebar-account-menu" ref={panel} role="menu">
          {/* One entry per area, not two to the same page. "Edit your profile"
              and "Settings" both landed on /settings/account, which is a choice
              that is not one (ADR-0032). */}
          <a role="menuitem" href={paths.settings()} onClick={() => setOpen(false)}>
            <PersonIcon />
            {t('account.yourSettings')}
          </a>
          {/* The shortcut stays (ADR-0067): it is how people reach the settings
              for what they are looking at, and removing it to prove a point
              about structure would remove the useful thing. It goes to the same
              screen as the list below, with the current workspace's id. */}
          <a role="menuitem" href={paths.workspaceSettings()} onClick={() => setOpen(false)}>
            <SettingsIcon />
            {t('account.thisWorkspace')}
          </a>
          {/* And the list, which everybody may open — the answer's length is
              the right. It was inside the administration, which is why a member
              had no list at all. */}
          <a role="menuitem" href={paths.workspaces()} onClick={() => setOpen(false)}>
            <WorkspacesIcon />
            {t('account.workspaces')}
          </a>
          {/* Absent rather than present and refusing, for the reason ADR-0027
              gives: an entry that answers "not found" teaches people to distrust
              the menu. */}
          {canAdminister && (
            <a role="menuitem" href={paths.admin()} onClick={() => setOpen(false)}>
              <SlidersIcon />
              {t('account.administration')}
            </a>
          )}
          {/* Above the trash: it is the thing somebody came to the menu for
              when the count is showing. */}
          <a role="menuitem" href={paths.inbox()} onClick={() => setOpen(false)}>
            <BellIcon />
            {unread > 0 ? t('account.inbox.waiting', { count: unread }) : t('account.inbox')}
          </a>
          <a role="menuitem" href={paths.trash()} onClick={() => setOpen(false)}>
            <TrashIcon />
            {t('account.trash')}
          </a>
          {/* Last and set apart: the one entry here somebody cannot undo by
              pressing it again. */}
          <button type="button" role="menuitem" onClick={onLogout}>
            <SignOutIcon />
            {t('account.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
