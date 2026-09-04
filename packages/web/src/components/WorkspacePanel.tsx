/**
 * SONE web — the Workspaces mode's column (ADR-0070).
 *
 * Two pieces, because the column has two parts. The chooser goes in the head,
 * where it says which workspace this column is about; the menu goes in the
 * body, where it navigates that workspace's sections. Same shape as the tree's
 * mode, where the head is the switcher and the body is the tree.
 *
 * The chooser is why this is a mode rather than a group in the settings list.
 * Your settings and the server's each have exactly one subject; a workspace's
 * settings have one per workspace, so the first question is *which* — and a
 * question with an answer per row is a chooser, not a heading. Put it in the
 * settings list instead and the same menu offers "Mailserver" three rows under
 * a workspace's name, as though a workspace could have its own.
 *
 * Choosing also switches you into that workspace. It is the same switcher the
 * tree's head carries, doing the same thing: after choosing "natec" here, the
 * mark takes you to natec's pages. One component, so the two cannot come to
 * mean different things — and one act, so "configure this one" never leaves you
 * editing a workspace you are not standing in.
 *
 * What is *not* here is the table. The list screen beside this column compares
 * workspaces — role, size, the deleted ones and their restore — and this column
 * opens one (ADR-0067). The panel navigates, the table shows.
 */

import type { ReactElement } from 'react';

import type { WorkspaceIcon } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { paths } from '../routes/paths.ts';
import { SECTIONS } from './WorkspaceSettingsScreen.tsx';
import { WorkspaceMenu } from './WorkspaceMenu.tsx';

interface ChosenWorkspace {
  /** The workspace the column is about. */
  chosenId: string;
  chosenName: string;
  /** Its mark, so the chooser looks the same here as in the tree's head. */
  chosenIcon: WorkspaceIcon | null;
  /**
   * Where the content area currently is, which is what marks a row.
   *
   * An href rather than a section id, because the list of every workspace is a
   * row in the same column and has no section of its own.
   */
  current: string;
}

/** Always with the id in it: a row meaning "whichever one I am in" is a row
 *  whose destination changes under it. */
function hrefFor(section: string, workspaceId: string): string {
  return paths.workspaceSettings(section, workspaceId);
}

/**
 * The chooser, for the panel's head.
 *
 * In the head rather than at the top of the body for a plain reason: the body
 * scrolls, and a menu that drops out of a scrolling box is clipped at its edge.
 * The head is also where the switcher already lives in the tree's mode, so the
 * two are in the same place at the same height.
 */
export function WorkspaceChooser({
  chosenId,
  chosenName,
  chosenIcon,
  current,
  onChoose,
}: ChosenWorkspace & {
  /**
   * Choosing one: switch to it, and land on `to`.
   *
   * The destination is decided here rather than by the switcher, because it
   * depends on where you already are — the same section under the new
   * workspace, or the list you were reading.
   */
  onChoose: (workspaceId: string, to: string) => void;
}): ReactElement {
  /*
   * Which section a switch lands on.
   *
   * The one being read, so choosing another workspace while looking at its
   * people shows the new workspace's people: the question did not change, only
   * what it is being asked about. From the list it stays the list — nothing
   * there is about one workspace, so there is nothing to carry over.
   */
  const section = SECTIONS.find((entry) => current === hrefFor(entry.id, chosenId))?.id;
  const list = paths.workspaces();

  return (
    <WorkspaceMenu
      currentIcon={chosenIcon}
      currentId={chosenId}
      currentName={chosenName}
      onSwitch={(id) => onChoose(id, section ? hrefFor(section, id) : list)}
      // A workspace you just made is one you want to be in, and its first
      // section is where its name is set — the one thing every new workspace
      // needs.
      onCreated={(id) => onChoose(id, hrefFor('general', id))}
    />
  );
}

/** The menu, for the panel's body: every workspace, then this one's sections. */
export function WorkspacePanel({
  chosenId,
  current,
}: Pick<ChosenWorkspace, 'chosenId' | 'current'>): ReactElement {
  const { t } = useT();
  const list = paths.workspaces();

  return (
    <>
      <div className="panel-menu-group">
        <a
          className="settings-nav-item"
          href={list}
          {...(current === list ? { 'aria-current': 'page' as const } : {})}
        >
          {t('workspaces.all')}
        </a>
      </div>

      <div className="panel-menu-group">
        {/* "This workspace" is honest here and was not in the settings list:
            there it named one of three groups and you could not see which
            workspace it meant, while here the chooser is the line above. */}
        <div className="sidebar-label">{t('workspaces.chosen')}</div>
        {SECTIONS.map((entry) => {
          const href = hrefFor(entry.id, chosenId);
          return (
            <a
              className="settings-nav-item"
              key={entry.id}
              href={href}
              title={t(entry.hint)}
              {...(href === current ? { 'aria-current': 'page' as const } : {})}
            >
              {t(entry.label)}
            </a>
          );
        })}
      </div>
    </>
  );
}
