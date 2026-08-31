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
import { useT } from '../i18n/useT.tsx';
import { paths } from '../routes/paths.ts';
import {
  PersonIcon,
  SettingsIcon,
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
        aria-label={t('account.label', { name: displayName })}
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
          <a role="menuitem" href={paths.workspaceSettings()} onClick={() => setOpen(false)}>
            <SettingsIcon />
            {t('account.thisWorkspace')}
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
