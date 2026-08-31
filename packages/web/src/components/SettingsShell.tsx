/**
 * SONE web — the frame the three settings areas share (ADR-0032).
 *
 * A list down one side, a section beside it, and on a phone the two are separate
 * views rather than a list stacked above a box a few lines tall.
 *
 * Extracted rather than copied. Three areas must not mean three layouts: they
 * would drift, and the one used least would rot — the same argument ADR-0031
 * made for having one way to order a list. What each area supplies is its own
 * entries and its own sections; nothing about the shape.
 */

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { paths } from '../routes/paths.ts';
import { AccountMenu } from './AccountMenu.tsx';
import {
  ChevronRightIcon,
  PersonIcon,
  SettingsIcon,
  SlidersIcon,
} from './icons.tsx';

export interface ShellSection {
  id: string;
  label: string;
  /** Shown as the entry's title, not under it. */
  hint: string;
}

/**
 * The three areas, as the switcher offers them.
 *
 * Named for the subject, as the areas themselves are (ADR-0032): whose settings
 * these are, not who may change them.
 */
const AREAS = [
  // The same marks the account menu uses for these three, deliberately: one
  // subject, one symbol, or somebody learns two of them for the same thing.
  { id: 'settings', label: 'Your settings', href: () => paths.settings(), Icon: PersonIcon },
  {
    id: 'workspace',
    label: 'This workspace',
    href: () => paths.workspaceSettings(),
    Icon: SettingsIcon,
  },
  { id: 'admin', label: 'Administration', href: () => paths.admin(), Icon: SlidersIcon },
] as const;

export type AreaId = (typeof AREAS)[number]['id'];

/**
 * Which settings area you are in, and the way to another.
 *
 * The same control the workspace switcher is, in the same place, because that is
 * where somebody has already learnt to look for "where am I, and what else is
 * there". What it holds is different — areas rather than workspaces — and that is
 * what its own label says; the two are never in one menu, because "which
 * workspace" and "whose settings" are different questions and merging them is how
 * a menu comes to mean two things.
 *
 * It replaces leaving the screen and coming back in: from the instance's
 * administration to your own profile used to be out through the notes.
 */
function AreaSwitcher({
  current,
  canAdminister,
  subtitle,
}: {
  current: AreaId;
  canAdminister: boolean;
  /**
   * What, specifically, is being configured — the workspace's own name.
   *
   * The area names the subject and this names the thing: "This workspace" is
   * true of five workspaces, and somebody with five needs to see which one they
   * are editing before they change its typography. A quieter second line rather
   * than a second control, because it is a fact and not a choice — choosing a
   * different one is what the administration list is for.
   */
  subtitle?: string | undefined;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

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

  // Absent rather than present and refusing, as the entry into it is
  // (ADR-0027).
  const available = AREAS.filter((area) => area.id !== 'admin' || canAdminister);
  const here = AREAS.find((area) => area.id === current) ?? AREAS[0];

  return (
    <div className="switcher-wrap">
      <button
        ref={button}
        className="switcher-button"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((previous) => !previous)}
      >
        <here.Icon />
        <span className="switcher-label">
          <span className="switcher-name">{here.label}</span>
          {subtitle && <span className="switcher-sub">{subtitle}</span>}
        </span>
        <ChevronRightIcon className="switcher-caret" />
      </button>

      {open && (
        <div className="switcher-menu" ref={panel} role="menu">
          {available.map((area) => (
            <a
              key={area.id}
              className="switcher-item"
              role="menuitem"
              href={area.href()}
              aria-current={area.id === current}
              onClick={() => setOpen(false)}
            >
              <area.Icon />
              <span className="switcher-item-name">{area.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

interface SettingsShellProps {
  /** Whose settings these are: "You", "This workspace", "The instance". */
  area: string;
  /** Which of the three, for the switcher at the top of the column. */
  areaId: AreaId;
  /** The thing being configured, where the area alone does not identify it. */
  subtitle?: string | undefined;
  /** Whose face sits at the foot of the column, and the menu behind it. */
  account: { displayName: string; userId: string; onLogout: () => void };
  /** Whether the administration area is offered at all. */
  canAdminister: boolean;
  sections: readonly ShellSection[];
  /** The section being shown. Already resolved by the caller. */
  current: string;
  hrefFor: (section: string) => string;
  /** Whether the phone is showing the list rather than the section. */
  listOpen: boolean;
  onListOpen: (open: boolean) => void;
  onClose: () => void;
  children: ReactNode;
}

export function SettingsShell({
  area,
  areaId,
  canAdminister,
  subtitle,
  account,
  sections,
  current,
  hrefFor,
  listOpen,
  onListOpen,
  onClose,
  children,
}: SettingsShellProps): ReactElement {
  return (
    <div className="settings-screen" data-showing={listOpen ? 'list' : 'section'}>
      <nav className="settings-nav" aria-label={`${area} settings`}>
        {/* Where the workspace switcher sits in the application: the same shape,
            in the same place, holding what this screen's context is. Before it,
            getting from the instance's administration to your own profile meant
            leaving the settings entirely and coming back in. */}
        <div className="settings-nav-head">
          <AreaSwitcher current={areaId} canAdminister={canAdminister} subtitle={subtitle} />
        </div>

        {/* The way back, first and plainly.
          *
          * A screen of its own needs a door out, and it belongs at the top of
          * the navigation rather than in a corner: it is the entry somebody
          * looks for when they have finished, and looking for it should not be
          * part of finishing. */}
        <button type="button" className="settings-back" onClick={onClose}>
          ‹ Back to your notes
        </button>

        {/* No heading over the list any more.
          *
          * There was one, naming the area — which the switcher above it now says,
          * and says as something you can act on. Two lines saying "This
          * workspace" one under the other is the kind of duplication that makes a
          * column feel like a form. `area` is still what the column is called to
          * a screen reader and on the phone's button. */}
        <div className="settings-nav-group">
          {sections.map((entry) => (
            <a
              key={entry.id}
              className="settings-nav-item"
              href={hrefFor(entry.id)}
              title={entry.hint}
              onClick={() => onListOpen(false)}
              {...(entry.id === current ? { 'aria-current': 'page' as const } : {})}
            >
              {/* The name alone. A line of explanation under each entry made
                  every one three lines tall, and a navigation that has to be
                  read is a page about the navigation. */}
              {entry.label}
            </a>
          ))}
        </div>

        {/* The same face and the same menu the sidebar carries.
          *
          * Because the switcher above only moves between areas: from here the
          * trash, and signing out, would otherwise mean going back to the notes
          * first. A column that has one of these and not the other is a column
          * somebody has to remember the rules for. */}
        <AccountMenu
          displayName={account.displayName}
          userId={account.userId}
          canAdminister={canAdminister}
          onLogout={account.onLogout}
        />
      </nav>

      <div className="settings-body">
        {/* Only on a phone, where the list is the other view rather than the
          * column beside this one. */}
        <button type="button" className="settings-menu-button" onClick={() => onListOpen(true)}>
          ☰ {area}
        </button>

        <h1>{sections.find((entry) => entry.id === current)?.label ?? area}</h1>

        {children}
      </div>
    </div>
  );
}

/** The section to show: the one asked for, or the first that exists. */
export function resolveSection(
  sections: readonly ShellSection[],
  asked: string,
): string {
  return sections.some((entry) => entry.id === asked) ? asked : sections[0]!.id;
}
