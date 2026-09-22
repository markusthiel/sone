/**
 * SONE web — the right sidebar.
 *
 * Tabs over one panel: outline now, properties now, more later. The pattern is
 * the one AFFiNE uses and it holds up — a narrow column that changes what it
 * shows is far better than several competing panels, because only one of them
 * is ever wanted at a time.
 *
 * A column on wide screens and a drawer on narrow ones, from the same markup —
 * the same arrangement as the left sidebar, and with the same trap avoided: the
 * backdrop is positioned and hidden *outside* any media query. Styling it only
 * inside the narrow block once made it an unstyled button in the page grid,
 * which took a column of its own and destroyed the layout on desktop.
 *
 * Which tab is open, and whether the panel is open at all, are remembered per
 * browser. Reopening a panel on every navigation is the kind of small friction
 * that makes an app feel like it is not paying attention.
 */

import type { PageHandle } from '@sone/client';
import type { CommentThread } from '@sone/core';

import type { WorkspaceMember } from '../api/client.ts';
import { useEffect, useState, type ReactElement } from 'react';

import {
  type CollectionField,
  type DerivedCellValue,
  type StoredCellValue, ApiError, api, type PageDetail } from '../api/client.ts';
import { useOutline, scrollToBlock } from '../hooks/useOutline.ts';
import { usePageTags } from '../hooks/usePageTags.ts';
import { useTasks, type Task } from '../hooks/useTasks.ts';
import { en, type MessageKey } from '../i18n/messages.en.ts';
import type { CommentMarkStyle } from '../hooks/useCommentMarkStyle.ts';
import type { CommentActions } from '../hooks/useComments.ts';
import { Cell } from './CollectionCell.tsx';
import { useT } from '../i18n/useT.tsx';
import { TagEditor } from './TagEditor.tsx';
import { messageFor } from './Auth.tsx';
import {
  ClockIcon,
  MessageIcon,
  CheckSquareIcon,
  ChevronRightIcon,
  PanelRightIcon,
  ExternalIcon,
  ImageIcon,
  LinkIcon,
  ListIcon,
  PageIcon,
  PaperclipIcon,
  SlidersIcon,
  TagIcon,
  UsersIcon,
  type IconProps,
} from './icons.tsx';
import { useDocAssets } from '../hooks/useDocAssets.ts';
import { openMediaModal } from './mediaModal.ts';
import { OPEN_THREAD_EVENT } from '../lib/found.ts';
import { CommentsPanel } from './CommentsPanel.tsx';
import { LinksPanel } from './LinksPanel.tsx';
import { HistoryPanel } from './HistoryPanel.tsx';
import { Contributors } from './Contributors.tsx';
import { highlightAuthor } from './authorHighlightBridge.ts';

export const RIGHT_TABS = [
  'outline',
  'tasks',
  // What the document refers to: attached files, images, and links out.
  // Between the structure of the page and the people on it, because these are
  // still about the page's own content.
  'files',
  'images',
  'links',
  // Before people: a discussion about the page is about the page, and the list
  // of who wrote it is about the people.
  'comments',
  // After the page's own content and before the people: a version is the page,
  // at another time.
  'history',
  'people',
  'properties',
] as const;
export type RightTab = (typeof RIGHT_TABS)[number];

/**
 * The tabs that are about the **page**, for a visitor holding a link.
 *
 * The panel is nine tabs and they are not one kind of thing. Four describe the
 * document in front of you — its structure, its attachments, its pictures, the
 * links out of it — and four describe the *workspace*: `history` names every
 * version and who wrote it, `people` lists the contributors, `tasks` their
 * assignees, `comments` the discussion among them.
 *
 * Which is why a link does not get a switch for this. "Show the right sidebar"
 * would either hand a stranger the version history and a list of colleagues'
 * names, or it would be a control whose only power is to hide an outline —
 * nobody would use the second and nobody would want the first. The division is
 * a property of the tabs, so the tabs are where it is written.
 *
 * `properties` is out too, and it is the near miss: page properties are the
 * page's own, but the panel edits them, and a link's visitor is not somebody
 * who should be setting them.
 */
export const PAGE_TABS = [
  'outline',
  'files',
  'images',
  'links',
] as const satisfies readonly RightTab[];

/**
 * An icon and a name per tab.
 *
 * Icons rather than words on the strip, because seven words do not fit a 300px
 * column and the strip will keep growing. The name is not lost: it is the
 * accessible label and the title, so the tab still says what it is to a screen
 * reader and to anybody who hovers — and the panel's own heading repeats it,
 * which is where somebody who has already chosen a tab reads it.
 */
const TABS: Record<RightTab, { label: MessageKey; Icon: (props: IconProps) => ReactElement }> = {
  // Keys, not names: this table is module-level and the strip translates them
  // where it draws them (ADR-0041). Typed as keys so handing a sentence to it is
  // a type error — which is what caught the same mistake in the administration
  // area, after it had shipped.
  outline: { label: 'panel.outline', Icon: ListIcon },
  tasks: { label: 'panel.tasks', Icon: CheckSquareIcon },
  files: { label: 'panel.files', Icon: PaperclipIcon },
  images: { label: 'panel.images', Icon: ImageIcon },
  links: { label: 'panel.links', Icon: LinkIcon },
  comments: { label: 'panel.comments', Icon: MessageIcon },
  history: { label: 'panel.history', Icon: ClockIcon },
  // "People" rather than "Contributors": shorter, and it does not imply a
  // ranking of who contributed most, which this list deliberately does not
  // measure.
  people: { label: 'panel.people', Icon: UsersIcon },
  properties: { label: 'panel.properties', Icon: SlidersIcon },
};

const OPEN_KEY = 'sone.rightPanel';
const TAB_KEY = 'sone.rightPanelTab';

export function readRightPanelOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function readTab(): RightTab {
  try {
    const stored = localStorage.getItem(TAB_KEY);
    return (RIGHT_TABS as readonly string[]).includes(stored ?? '')
      ? (stored as RightTab)
      : 'outline';
  } catch {
    return 'outline';
  }
}

interface RightSidebarProps {
  handle: PageHandle | null;
  pageId: string | null;
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  /**
   * Which tabs this panel offers. All of them, unless told otherwise.
   *
   * A subset rather than a set of booleans, because the strip is a list and
   * "which of these" is what a list is. `PAGE_TABS` is the one subset that
   * exists — see its note for why it is a property of the tabs and not a
   * setting somebody chooses.
   */
  tabs?: readonly RightTab[];
  /**
   * The page's comment threads, from the page rather than read here.
   *
   * The editor needs the same list to draw its marks, and two readers of one
   * document would disagree about the moment a thread appeared — so the page
   * owns the hook and hands it down (ADR-0046).
   */
  comments?: CommentActions;
  /** The internal threads, when this person may have them (ADR-0057). */
  internalComments?: CommentActions | null;
  /** The workspace's people, for naming a comment's author. */
  members?: WorkspaceMember[];
  /** Scroll to a thread's text and flash it. */
  onRevealComment?: (thread: CommentThread) => void;
  /** A selection waiting for its first message, and how to drop it. */
  pendingComment?: { from: Uint8Array; to: Uint8Array; quote: string } | null;
  onCancelPendingComment?: () => void;
  /** How much a commented passage is marked, and whether at all here. */
  marks?: { style: CommentMarkStyle; setStyle: (style: CommentMarkStyle) => void };
  /** Which past version is being read, and how to choose one (ADR-0047). */
  viewingVersion?: string | null;
  onViewVersion?: (versionId: string | null) => void;
  /** Show what a version changed (ADR-0053). */
  onCompareVersion?: (versionId: string) => void;
}

export function RightSidebar({
  handle,
  pageId,
  workspaceId,
  open,
  onClose,
  tabs = RIGHT_TABS,
  comments,
  internalComments,
  members,
  onRevealComment,
  pendingComment,
  onCancelPendingComment,
  marks,
  viewingVersion,
  onViewVersion,
  onCompareVersion,
}: RightSidebarProps): ReactElement {
  const { t } = useT();
  /*
   * The remembered tab, unless this panel does not offer it.
   *
   * Without the clamp a stored `history` would select a tab the strip does not
   * draw, and the panel would open on a heading with nothing under it — which
   * is what "remember the choice" turns into the moment the choices differ by
   * context.
   */
  const [tab, setTab] = useState<RightTab>(() => {
    const stored = readTab();
    return tabs.includes(stored) ? stored : (tabs[0] ?? 'outline');
  });

  /*
   * And a click on a comment mark brings the comments forward (ADR-0168).
   *
   * Only if this panel offers them: a shared link's strip has four tabs and
   * `comments` is deliberately not among them (ADR-0114), and switching to a
   * tab the strip does not draw is a heading with nothing under it — the fault
   * the clamp above exists to prevent, arriving from the other side.
   */
  useEffect(() => {
    if (!tabs.includes('comments')) return undefined;
    const show = (): void => setTab('comments');
    window.addEventListener(OPEN_THREAD_EVENT, show);
    return () => window.removeEventListener(OPEN_THREAD_EVENT, show);
  }, [tabs]);

  /*
   * Only a full panel writes the preference back.
   *
   * The key is per browser, and a member who opens a shared link in their own
   * browser is the same browser: a restricted panel that stored its choice
   * would quietly reset the workspace's own panel to the outline. A view that
   * cannot offer every tab has no business deciding which one everybody gets.
   */
  const remembers = tabs.length === RIGHT_TABS.length;
  useEffect(() => {
    if (!remembers) return;
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // Storage disabled. Losing the preference is acceptable.
    }
  }, [tab, remembers]);

  return (
    <>
      {open && (
        <button
          className="scrim scrim-right"
          type="button"
          aria-label={t('panel.close')}
          onClick={onClose}
        />
      )}
      <aside
        className={`right-panel${open ? ' open' : ''}`}
        aria-label={t('panel.label')}
        /*
         * Closed means unreachable, not merely unannounced.
         *
         * `aria-hidden` keeps a screen reader from reading it and does *nothing*
         * about the tab order — every button inside stayed focusable. That was
         * survivable while a closed panel was removed from the DOM; now that it
         * stays there to slide, a tab from the page would land in a drawer
         * nobody can see. `inert` is the attribute that means both.
         */
        {...(open ? {} : { 'aria-hidden': true, inert: true })}
      >
        <div className="right-tabs" role="tablist" aria-label={t('panel.label')}>
          {tabs.map((name) => {
            const { label, Icon } = TABS[name];
            return (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                className="right-tab"
                // The name, for a screen reader and for a pointer. An icon-only
                // control with neither is a symbol somebody has to learn by
                // pressing it.
                aria-label={t(label)}
                title={t(label)}
                onClick={() => setTab(name)}
              >
                <Icon />
              </button>
            );
          })}
        </div>

        {/* Which tab is open, in words. The strip says it in symbols; this is
            where somebody reads it back. */}
        <p className="right-panel-title">{t(TABS[tab].label)}</p>

        {/* Keyed on the tab so the fade runs on every switch: without a key
            React reuses the element and a CSS animation does not restart
            (ADR-0042). */}
        <div className="right-body" role="tabpanel" key={tab}>
          {tab === 'outline' && <OutlinePanel handle={handle} />}
          {tab === 'tasks' && <TasksPanel handle={handle} />}
          {/* Who has written here — not who is here now, which the circles at
              the top of the page show instead (ADR-0022). */}
          {tab === 'people' && (
            <Contributors
              handle={handle}
              workspaceId={workspaceId}
              onHighlight={highlightAuthor}
            />
          )}
          {tab === 'files' && <FilesPanel handle={handle} />}
          {tab === 'images' && <ImagesPanel handle={handle} />}
          {tab === 'links' && (
            <LinksPanel handle={handle} pageId={pageId} workspaceId={workspaceId} />
          )}
          {/* Guarded on the props as well as the tab.
            *
            * These two are the tabs a restricted panel leaves out, so their
            * props are optional — and a condition that only checks the tab
            * would make the type-checker's permission to omit them a promise
            * this file breaks. The guard is the other half of `tabs`: leave a
            * tab out and its props may go too. */}
          {tab === 'history' && onViewVersion && onCompareVersion && (
            <HistoryPanel
              pageId={pageId}
              members={members ?? []}
              viewing={viewingVersion ?? null}
              onView={onViewVersion}
              onCompare={onCompareVersion}
            />
          )}
          {tab === 'comments' && comments && marks && onRevealComment && onCancelPendingComment && (
            <CommentsPanel
              comments={comments}
              internal={internalComments ?? null}
              members={members ?? []}
              canEdit={handle?.canEdit !== false}
              // The smaller right, and the one the reply box hangs on. `!== false`
              // for the same reason as above: no handle yet is not a refusal.
              canComment={handle?.canComment !== false}
              onReveal={onRevealComment}
              pending={pendingComment ?? null}
              onCancelPending={onCancelPendingComment}
              marks={marks}
              pageId={pageId}
              // For the one question a thread cannot answer about itself: is the
              // document it points at still on this page (ADR-0159).
              doc={handle?.doc ?? null}
            />
          )}
          {tab === 'properties' && (
            <PropertiesPanel pageId={pageId} handle={handle} workspaceId={workspaceId} />
          )}
        </div>
      </aside>
    </>
  );
}

/**
 * The files attached in this document.
 *
 * The row opens the file, because that is what somebody came to this list for;
 * the trailing control jumps to where the file sits in the page, which is the
 * other thing they might want and a much rarer one.
 *
 * A file still uploading has no id yet. Listed anyway, without a link: a block
 * that is visibly on the page and missing from the list reads as the list being
 * wrong rather than as the upload being unfinished.
 */
function FilesPanel({ handle }: { handle: PageHandle | null }): ReactElement {
  const { t } = useT();
  const { files } = useDocAssets(handle?.doc ?? null);

  if (!handle) return <p className="panel-empty">{t('panel.openForFiles')}</p>;
  if (files.length === 0) {
    return (
      <p className="panel-empty">
        {t('panel.noFiles', { shortcut: '/file' })}
      </p>
    );
  }

  return (
    <ul className="asset-list">
      {files.map((file) => (
        <li key={file.blockId}>
          {file.fileId ? (
            <a
              className="asset-row"
              href={`/api/files/${file.fileId}`}
              target="_blank"
              rel="noreferrer"
              // A picture or a video opens over the page, as it does from the
              // block (ADR-0193); everything else is handed to the browser,
              // which is what a PDF or a spreadsheet wants. The address stays
              // on the link, so ⌘-click still reaches the file itself.
              onClick={(event) => {
                if (file.category !== 'image' && file.category !== 'video') return;
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                openMediaModal({
                  kind: file.category === 'video' ? 'video' : 'image',
                  url: `/api/files/${file.fileId ?? ''}`,
                  name: file.filename || t('panel.untitledFile'),
                  labels: { close: t('media.close'), download: t('media.download') },
                });
              }}
            >
              <PaperclipIcon />
              <span className="asset-name">{file.filename || t('panel.untitledFile')}</span>
              <span className="asset-meta">{describeFile(file.category, file.sizeBytes)}</span>
            </a>
          ) : (
            <span className="asset-row" aria-disabled="true">
              <PaperclipIcon />
              <span className="asset-name">{file.filename || t('panel.untitledFile')}</span>
              <span className="asset-meta">{t('panel.uploading')}</span>
            </span>
          )}
          <button
            type="button"
            className="asset-jump"
            title={t('panel.showInPage')}
            aria-label={t('panel.showThisInPage', { filename: file.filename || t('panel.thisFile') })}
            onClick={() => scrollToBlock(file.blockId)}
          >
            <PageIcon />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A category and a size, where there is one. */
function describeFile(category: string, sizeBytes: number | null): string {
  if (sizeBytes === null) return category;
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = sizeBytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${category} · ${rounded} ${units[unit]}`;
}

/**
 * The images in this document, as thumbnails.
 *
 * Thumbnails rather than filenames: an image is recognised by looking at it, and
 * a list of URLs would be the one presentation that makes an image harder to
 * find than scrolling would.
 *
 * Clicking one goes to where it sits rather than opening the file — an image is
 * already visible, so what somebody wants from this list is the place.
 */
function ImagesPanel({ handle }: { handle: PageHandle | null }): ReactElement {
  const { t } = useT();
  const { images } = useDocAssets(handle?.doc ?? null);

  if (!handle) return <p className="panel-empty">{t('panel.openForImages')}</p>;
  if (images.length === 0) {
    return <p className="panel-empty">{t('panel.noImages')}</p>;
  }

  return (
    <div className="asset-grid">
      {images.map((image) => (
        <button
          key={image.blockId}
          type="button"
          className="asset-thumb"
          // A picture on a board has no block to scroll to, so pressing it opens
          // the file rather than pretending to find it on the page. Saying
          // "show in the page" and doing nothing is worse than doing something
          // else and saying so.
          title={image.alt || t(image.onCanvas || image.asFile ? 'panel.openImage' : 'panel.showInPage')}
          aria-label={
            image.alt || t(image.onCanvas || image.asFile ? 'panel.openImage' : 'panel.showInPage')
          }
          onClick={() => {
            if (image.onCanvas) {
              window.open(image.url, '_blank', 'noopener');
              return;
            }
            // A picture the page holds as a card or a line has a block to jump
            // to, but nothing to look at once you are there (ADR-0193). So this
            // one opens it instead — the panel's promise is "the pictures in
            // this page", and for this row the picture is the answer.
            if (image.asFile) {
              openMediaModal({
                kind: 'image',
                url: image.url,
                name: image.alt || t('panel.untitledFile'),
                labels: { close: t('media.close'), download: t('media.download') },
              });
              return;
            }
            scrollToBlock(image.blockId);
          }}
        >
          {image.url ? (
            <img src={image.url} alt="" loading="lazy" />
          ) : (
            <span className="asset-thumb-empty">{t('panel.uploading')}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * The links out of this document.
 *
 * The row opens the destination. The host is shown under the text because a link
 * called "here" or "the report" says nothing about where it goes, and a list of
 * those is a list of nothing.
 */
function OutlinePanel({ handle }: { handle: PageHandle | null }): ReactElement {
  const { t } = useT();
  const outline = useOutline(handle?.doc ?? null);

  if (!handle) {
    return <p className="panel-empty">{t('panel.openForOutline')}</p>;
  }
  if (outline.length === 0) {
    // Says what to do rather than only that there is nothing, because an empty
    // outline on a page full of text looks like a fault.
    return (
      <p className="panel-empty">
        {t('panel.noHeadings', { shortcut: '# ' })}
      </p>
    );
  }

  // Indentation is relative to the shallowest heading present, so a document
  // that starts at level 2 is not drawn with a permanent empty first level.
  const shallowest = Math.min(...outline.map((entry) => entry.level));

  return (
    <nav className="outline" aria-label={t('panel.outline')}>
      {outline.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="outline-entry"
          style={{ paddingInlineStart: `${8 + (entry.level - shallowest) * 12}px` }}
          data-level={entry.level}
          onClick={() => scrollToBlock(entry.id)}
        >
          {entry.text || <span className="muted">{t('panel.untitledHeading')}</span>}
        </button>
      ))}
    </nav>
  );
}

function TasksPanel({ handle }: { handle: PageHandle | null }): ReactElement {
  const { t } = useT();
  const { tasks, toggle } = useTasks(handle?.doc ?? null);
  const canEdit = handle?.canEdit ?? false;

  if (!handle) {
    return <p className="panel-empty">{t('panel.openForTasks')}</p>;
  }
  if (tasks.length === 0) {
    return (
      <p className="panel-empty">
        {t('panel.noTasks', { shortcut: '[] ' })}
      </p>
    );
  }

  const open = tasks.filter((task) => !task.done);
  const done = tasks.filter((task) => task.done);

  return (
    <div className="tasks">
      {/* A count, because the useful question about a task list is how much is
          left rather than what is in it. */}
      <p className="tasks-summary">
        {t('panel.tasksOpen', { open: open.length, total: tasks.length })}
      </p>

      {open.map((task) => (
        <TaskRow key={task.id} task={task} canEdit={canEdit} onToggle={toggle} />
      ))}

      {done.length > 0 && (
        <>
          {/* Completed tasks are kept, below, rather than hidden. Hiding them
              loses the record of what was done, and a list that empties itself
              gives no sense of progress. */}
          <p className="tasks-label">{t('panel.done')}</p>
          {done.map((task) => (
            <TaskRow key={task.id} task={task} canEdit={canEdit} onToggle={toggle} />
          ))}
        </>
      )}
    </div>
  );
}

function TaskRow({
  task,
  canEdit,
  onToggle,
}: {
  task: Task;
  canEdit: boolean;
  onToggle: (taskId: string, done: boolean) => void;
}): ReactElement {
  const { t } = useT();
  return (
    <label
      className="task-row"
      data-done={task.done ? 'true' : 'false'}
      style={{ paddingInlineStart: `${8 + Math.min(task.indent, 4) * 14}px` }}
    >
      <input
        type="checkbox"
        checked={task.done}
        // Disabled rather than hidden for a reader: the state is information,
        // and removing the control while keeping the box would look broken.
        disabled={!canEdit}
        onChange={(event) => onToggle(task.id, event.target.checked)}
      />
      <span className="task-text">
        {task.text || <span className="muted">{t('panel.untitledTask')}</span>}
      </span>
      {/* Jumping to the block is what makes the panel a way of navigating rather
          than a second place to keep the same list. */}
      <button
        type="button"
        className="task-goto"
        aria-label={t('panel.goToTask')}
        onClick={(event) => {
          event.preventDefault();
          scrollToBlock(task.id);
        }}
      >
        <ChevronRightIcon />
      </button>
    </label>
  );
}

function PropertiesPanel({
  pageId,
  handle,
  workspaceId,
}: {
  pageId: string | null;
  handle: PageHandle | null;
  workspaceId: string;
}): ReactElement {
  const { t } = useT();
  const { tags, known, setTags } = usePageTags(handle?.doc ?? null, pageId, workspaceId);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  /**
   * The row's own fields, when this page is one (ADR-0054).
   *
   * Asked of every page the panel opens, because "this page has no fields" is
   * the truthful answer for most of them and one request is cheaper than
   * deciding here whether to ask.
   */
  const [row, setRow] = useState<{
    canEdit: boolean;
    fields: CollectionField[];
    values: Record<string, StoredCellValue | undefined>;
    derived: Record<string, DerivedCellValue | undefined>;
  } | null>(null);

  useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    void api
      .rowProperties(pageId)
      .then((result) => {
        if (cancelled) return;
        setRow(
          result.fields.length > 0
            ? {
                canEdit: result.canEdit ?? false,
                fields: result.fields,
                values: result.values,
                derived: result.derived,
              }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setRow(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);
  const [error, setError] = useState<string | null>(null);

  /**
   * Change how wide the page is drawn.
   *
   * The panel's own copy is updated first and the request follows, so the page
   * reflows as the button is pressed rather than after a round trip — and the
   * page itself reads the width from the same detail, so both change together.
   */
  const onWidth = async (width: 'column' | 'full'): Promise<void> => {
    if (!pageId) return;
    setDetail((current) => (current ? { ...current, width } : current));
    try {
      await api.setPageWidth(pageId, width);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  // Fetched when the tab is shown rather than with the page: most of what is
  // here does not change while reading, and a request nobody looked at is
  // waste.
  useEffect(() => {
    if (!pageId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setError(null);
    void api
      .page(pageId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  if (!pageId) {
    return <p className="panel-empty">{t('panel.openForProperties')}</p>;
  }
  if (error) {
    return <p className="error panel-empty">{messageFor(error)}</p>;
  }
  if (!detail) {
    return <p className="panel-empty muted">{t('panel.loading')}</p>;
  }

  const formatted = (value: string): string =>
    new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

  return (
    <dl className="properties">
      {/* The row's own fields, first (ADR-0054).
        *
        * Above the page's kind and dates, because on a row page these *are* the
        * page: somebody opening an invoice wants its amount and its client, not
        * that it is a row created on Tuesday. The panel's existing contents are
        * still below, unchanged, for every page including this one. */}
      {row && (
        <>
          {row.fields.map((field) => (
            <div key={field.id} className="properties-row">
              <dt>{field.name}</dt>
              <dd>
                {/* The same renderer the table uses, which is why it moved into
                    its own module: two of them would drift, and the one that
                    drifted would be this one. */}
                <Cell
                  field={field}
                  value={row.values[field.id] ?? null}
                  derived={row.derived[field.id] ?? null}
                  canEdit={row.canEdit}
                  // No file index here: a files cell falls back to naming what
                  // it has, which is honest, and fetching the workspace's file
                  // list to draw one row's attachments is not a trade worth
                  // making in a side panel.
                  files={new Map()}
                  pageId={pageId ?? ''}
                  onChange={(value) => {
                    if (!pageId) return;
                    // Optimistic, like the table's cells: the panel is beside
                    // the page and a value that waits for a round trip reads as
                    // a control that did not take.
                    setRow((current) =>
                      current
                        ? {
                            ...current,
                            values: { ...current.values, [field.id]: value ?? undefined },
                          }
                        : current,
                    );
                    void api.setCellValue(pageId, field.id, value);
                  }}
                  onUploaded={() => {}}
                />
              </dd>
            </div>
          ))}
        </>
      )}

      <dt>
        <PageIcon /> {t('panel.kind')}
      </dt>
      <dd>
        {detail.kind === 'folder'
          ? t('panel.kind.folder')
          : detail.kind === 'canvas'
            ? t('panel.kind.canvas')
            : t('panel.kind.page')}
      </dd>

      {/* How wide this page is drawn.
        *
        * Here rather than in the ⋮ menu because it is a property of the page
        * being read, and this is the panel of properties — and because the ⋮
        * menu is the tree's, which is the wrong place to decide how something
        * looks when you are inside it. */}
      {detail.kind !== 'folder' && (
        <>
          <dt>{t('panel.width')}</dt>
          <dd>
            <div className="panel-choices" role="group" aria-label={t('panel.width')}>
              {(
                [
                  ['column', 'panel.width.column'],
                  ['full', 'panel.width.full'],
                ] as const
              ).map(([value, key]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    (detail.width ?? 'column') === value
                      ? 'panel-choice current'
                      : 'panel-choice'
                  }
                  aria-pressed={(detail.width ?? 'column') === value}
                  onClick={() => void onWidth(value)}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </dd>
        </>
      )}

      <dt>{t('panel.created')}</dt>
      <dd>{formatted(detail.createdAt)}</dd>

      <dt>{t('panel.edited')}</dt>
      <dd>{formatted(detail.lastEditedAt)}</dd>

      <dt>{t('panel.yourAccess')}</dt>
      {/* From the page detail rather than from the handle: the handle's role is
          null while a document opens or reconnects, and reporting "none" for
          that moment is how the read-only notice came to lie to the owner of a
          workspace. */}
      <dd>{detail.role}</dd>

      <dt>{t('panel.sync')}</dt>
      <dd>
        {/* A status the catalogue knows is translated; anything else is a word
            from the sync client and is shown as it is. */}
        {(() => {
          const key = handle ? describeStatus(handle) : 'panel.sync.notOpen';
          return key in en ? t(key as MessageKey) : key;
        })()}
      </dd>

      <dt>
        <TagIcon /> {t('panel.tags')}
      </dt>
      <dd>
        <TagEditor
          tags={tags}
          known={known}
          canEdit={handle?.canEdit ?? false}
          onChange={setTags}
        />
      </dd>
    </dl>
  );
}

/**
 * Which message describes the sync state.
 *
 * A key rather than a sentence, because this is a helper outside any component
 * and cannot call a hook. An unknown status falls back to the status itself,
 * which is a word from the client rather than something to translate.
 */
function describeStatus(handle: PageHandle): MessageKey | string {
  switch (handle.status) {
    case 'synced':
      return 'panel.sync.upToDate';
    case 'syncing':
      return 'panel.sync.syncing';
    case 'offline':
      return 'panel.sync.offline';
    case 'denied':
      return 'panel.sync.denied';
    default:
      return handle.status;
  }
}

/** The toggle that lives in the top bar. */
export function RightPanelToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  const { t } = useT();
  return (
    <button
      className="quiet panel-toggle"
      type="button"
      aria-label={open ? t('panel.hide') : t('panel.show')}
      aria-expanded={open}
      onClick={onToggle}
    >
      <PanelRightIcon />
    </button>
  );
}
