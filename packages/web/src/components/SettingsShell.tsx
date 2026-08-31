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
import {
  ChevronRightIcon,
  SettingsIcon,
  SlidersIcon,
  UsersIcon,
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
  { id: 'settings', label: 'Your settings', href: () => paths.settings(), Icon: UsersIcon },
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
}: {
  current: AreaId;
  canAdminister: boolean;
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
        <span className="switcher-name">{here.label}</span>
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
          <AreaSwitcher current={areaId} canAdminister={canAdminister} />
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

        {/* One heading, naming whose settings these are.
          *
          * It used to be three headings in one list, which is what this splits
          * up: the group told you the subject and the list still asked you to
          * find it among ten entries belonging to three different subjects. */}
        <div className="settings-nav-group">
          <p className="sidebar-label">{area}</p>
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
