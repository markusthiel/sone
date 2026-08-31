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

import { type ReactElement, type ReactNode } from 'react';

export interface ShellSection {
  id: string;
  label: string;
  /** Shown as the entry's title, not under it. */
  hint: string;
}

interface SettingsShellProps {
  /** Whose settings these are: "You", "This workspace", "The instance". */
  area: string;
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
