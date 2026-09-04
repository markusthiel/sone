/**
 * The settings' menu — the panel, not the settings (ADR-0069).
 *
 * This is what is left of `SettingsShell` after stage two. The shell was a
 * screen: it drew its own column, its own way back, its own account menu and a
 * switcher between three areas, all because it covered the application
 * entirely. None of that is needed once the rail is always there — the way back
 * is the mark, the account is at the foot of the rail, and the three areas are
 * three groups in one list rather than a menu you have to open to discover the
 * other two.
 *
 * A phone special case went with it. The shell flipped between "the list" and
 * "the section" with a data attribute; here the list is the panel, and on a
 * phone the panel is already the drawer. One mechanism instead of two.
 */

import type { ReactElement } from 'react';

/** One entry in a settings list, translated by whoever renders it. */
export interface ShellSection {
  id: string;
  label: string;
  hint?: string;
}

export interface SectionGroup {
  /** What the group is about: you, a workspace by name, the instance. */
  title: string;
  sections: readonly ShellSection[];
  hrefFor: (section: string) => string;
}

/** The section to show: the one asked for, or the first that exists. */
export function resolveSection(sections: readonly ShellSection[], asked: string): string {
  return sections.some((entry) => entry.id === asked) ? asked : sections[0]!.id;
}

export function SectionNav({
  groups,
  current,
}: {
  groups: readonly SectionGroup[];
  /** The href of the section being shown, which is what marks it. */
  current: string;
}): ReactElement {
  return (
    <>
      {groups.map((group) => (
        <div className="panel-menu-group" key={group.title}>
          <div className="sidebar-label">{group.title}</div>
          {group.sections.map((entry) => (
            <a
              key={`${group.title}-${entry.id}`}
              className="settings-nav-item"
              href={group.hrefFor(entry.id)}
              title={entry.hint}
              {...(group.hrefFor(entry.id) === current
                ? { 'aria-current': 'page' as const }
                : {})}
            >
              {/* The name alone. A line of explanation under each entry made
                  every one three lines tall, and a navigation that has to be
                  read is a page about the navigation. */}
              {entry.label}
            </a>
          ))}
        </div>
      ))}
    </>
  );
}
