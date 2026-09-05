/**
 * SONE web — app root.
 *
 * Routing, session gating and layout. Deliberately the only place that knows
 * about all of those at once; everything else takes what it needs as props.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { LoginScreen, SetupScreen, SignupScreen, useMessage, ResetScreen,
  SecondFactorRequired,
} from './components/Auth.tsx';
import { FolderView } from './components/FolderView.tsx';
import { IconRail } from './components/IconRail.tsx';
import { modeOf } from './components/modes.tsx';
import { AccountMenu } from './components/AccountMenu.tsx';
import { InboxPanel, type InboxView } from './components/InboxPanel.tsx';
import { TrashPanel, type TrashView } from './components/TrashPanel.tsx';
import { useInbox } from './hooks/useInbox.ts';
import { SectionNav, resolveSection, type SectionGroup } from './components/SectionNav.tsx';
import { SECTIONS as YOU_SECTIONS } from './components/Settings.tsx';
import { SECTIONS as WORKSPACE_SECTIONS } from './components/WorkspaceSettingsScreen.tsx';
import { ADMIN_SECTIONS } from './components/AdminScreen.tsx';
import type { TrashEntry } from './api/client.ts';
import { MoveDialog } from './components/MoveDialog.tsx';
import { MoveToWorkspaceDialog } from './components/MoveToWorkspaceDialog.tsx';
import { ShareDialog } from './components/ShareDialog.tsx';
import { Trash } from './components/Trash.tsx';
import { SidebarIcon } from './components/icons.tsx';
import { EntryIconView } from './components/EntryIconView.tsx';
import { PageStatus, PageView } from './components/PageView.tsx';
import {
  PAGE_TABS,
  RightPanelToggle,
  RightSidebar,
  readRightPanelOpen,
} from './components/RightSidebar.tsx';
import { SearchScreen } from './components/Search.tsx';
import { LocaleProvider, resolveLocale, useT } from './i18n/useT.tsx';
import { StaleBundleNotice } from './components/StaleBundleNotice.tsx';
import { AdminScreen } from './components/AdminScreen.tsx';
import { Settings } from './components/Settings.tsx';
import { SharesScreen } from './components/SharesScreen.tsx';
import { WorkspaceListScreen } from './components/WorkspaceListScreen.tsx';
import { ModeBar } from './components/ModeBar.tsx';
import { WorkspaceChooser, WorkspacePanel } from './components/WorkspacePanel.tsx';
import { WorkspaceSettingsScreen } from './components/WorkspaceSettingsScreen.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { usePage, useSoneClient } from './hooks/useSoneClient.ts';
import { useLinkInterception, useRoute } from './hooks/useRoute.ts';
import { usePages } from './hooks/usePages.ts';
import { useWorkspaceTheme } from './hooks/useWorkspaceTheme.ts';
import { useFavourites } from './hooks/useFavourites.ts';
import { useWatching } from './hooks/useWatching.ts';
import { useCommentMarkStyle } from './hooks/useCommentMarkStyle.ts';
import { ExportDialog } from './components/ExportDialog.tsx';
import { ImportDialog } from './components/ImportDialog.tsx';
import { InboxScreen } from './components/InboxScreen.tsx';
import { useComments } from './hooks/useComments.ts';
import { useScrolled } from './hooks/useScrolled.ts';
import { useSession } from './hooks/useSession.ts';
import { useSidebar } from './hooks/useSidebar.ts';
import { asInternalRequest } from '@sone/core';
import type { CommentThread } from '@sone/core';
import type { CommentAnchor, DrawnThread } from '@sone/editor';

import { api, type PageNode, type WorkspaceMember } from './api/client.ts';
import { MOVED_SETTINGS, paths, type Route } from './routes/paths.ts';
import { AcceptInvitation } from './components/AcceptInvitation.tsx';

export function App(): ReactElement {
  const { route, navigate } = useRoute();
  useLinkInterception(navigate);
  const { state, reload, logout, selectWorkspace } = useSession();

  /**
   * The language, for every screen including the ones with nobody signed in
   * (ADR-0041).
   *
   * Resolved here, above the branches, so the sign-in and setup screens are
   * translated too. They have no session to ask, so what they get is the
   * instance's own negotiation of `Accept-Language` — which the server has been
   * doing all along and nothing was using.
   *
   * Signed in, the person's own setting wins over the workspace's, and both win
   * over the browser's.
   */
  const session = state.status === 'authenticated' ? state.session : null;
  const instance = 'instance' in state ? state.instance : null;
  const workspace =
    state.status === 'authenticated'
      ? state.session.workspaces.find((w) => w.id === state.workspaceId)
      : undefined;

  return (
    <LocaleProvider
      initial={resolveLocale(
        session?.user.locale,
        workspace?.default_locale ?? instance?.suggestedLocale,
      )}
      // The tone of the house, chosen by whoever runs the instance. Delivered
      // with `/api/instance` rather than with the session precisely so that the
      // sign-in screen is addressed the same way as everything behind it.
      address={
        (state.status === 'authenticated' ? state.instance : instance)?.addressForm ??
        'informal'
      }
    >
      <Routes
        state={state}
        route={route}
        navigate={navigate}
        reload={reload}
        logout={logout}
        selectWorkspace={selectWorkspace}
      />
    </LocaleProvider>
  );
}

/**
 * Every screen, once the language is known.
 *
 * Split from `App` only so the provider can wrap all of it: the branches below
 * return early, and a provider cannot wrap an early return from outside it.
 */
function Routes({
  state,
  route,
  navigate,
  reload,
  logout,
  selectWorkspace,
}: {
  state: ReturnType<typeof useSession>['state'];
  route: Route;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  reload: () => Promise<void> | void;
  logout: () => Promise<void> | void;
  selectWorkspace: (id: string) => void;
}): ReactElement {
  const { t } = useT();
  const message = useMessage();

  // --- unauthenticated routes ---------------------------------------------

  if (state.status === 'loading') {
    return (
      <div className="centered">
        <p className="muted">{t('auth.loading')}</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="centered">
        <div className="card">
          <h1>{t('auth.cannotStart')}</h1>
          <p className="error">{message(state.code)}</p>
          <button type="button" className="btn" onClick={() => void reload()}>
            {t('auth.tryAgain')}
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'needsSetup') {
    // Setup outranks the requested route: nothing else can work yet, and
    // redirecting would lose the fact that this is a fresh instance.
    return <SetupScreen onDone={() => void reload()} navigate={navigate} />;
  }

  // An invitation followed by somebody who is already signed in.
  //
  // The sign-up route below only renders for anonymous visitors, so this used
  // to do nothing visible: the person landed in their own workspace with no
  // sign the link had meant anything, and the invitation was not consumed.
  if (state.status === 'authenticated' && route.kind === 'signup' && route.invitationToken) {
    return (
      <AcceptInvitation
        token={route.invitationToken}
        navigate={navigate}
        onJoined={(workspaceId) => {
          if (workspaceId) selectWorkspace(workspaceId);
          void reload();
        }}
      />
    );
  }

  if (state.status === 'anonymous') {
    if (route.kind === 'share') {
      return <ShareRoute token={route.token} pageId={route.pageId} />;
    }
    if (route.kind === 'signup') {
      return (
        <SignupScreen
          onDone={(workspaceId) => {
            // Away from the invitation link, then reload.
            //
            // Registering *uses* the invitation, so leaving the token in the
            // address bar meant the accept screen below rendered next, looked
            // the token up, found it spent, and said something went wrong —
            // after everything had gone right.
            //
            // And land where the invitation pointed. Everybody now has a
            // workspace of their own (ADR-0025), so without this somebody who
            // accepted an invitation arrives in their own empty one — a member
            // of the team they joined, looking at nothing to do with it.
            if (workspaceId) selectWorkspace(workspaceId);
            navigate(paths.home());
            void reload();
          }}
          navigate={navigate}
          invitationToken={route.invitationToken}
        />
      );
    }
    /*
     * A reset link lands here, signed out (ADR-0059).
     *
     * Before the login screen, because somebody arriving from a mail has a
     * token in the address and should not be shown a sign-in form for the
     * password they are about to replace.
     */
    if (route.kind === 'reset') {
      return <ResetScreen token={route.token} navigate={navigate} />;
    }

    return (
      <LoginScreen
        onDone={() => void reload()}
        navigate={navigate}
        instance={state.instance}
      />
    );
  }

  // --- authenticated ------------------------------------------------------

  /*
   * The requirement, after the grace period (ADR-0065).
   *
   * Before the workspace, because the point is that nothing else is reachable
   * — including reading. A stolen password that grants read access to a
   * company's notes has granted the thing that mattered.
   *
   * The server refuses the requests anyway; this is so somebody sees why
   * rather than a screen of failures.
   */
  if (state.session?.user.secondFactorStanding?.kind === 'blocked') {
    return <SecondFactorRequired onDone={() => void reload()} />;
  }

  return (
    <Workspace
      workspaceId={state.workspaceId}
      workspaceName={
        state.session.workspaces.find((w) => w.id === state.workspaceId)?.name ??
        'Workspace'
      }
      displayName={state.session.user.displayName}
      session={state.session}
      route={route}
      navigate={navigate}
      onSwitchWorkspace={(id, to = paths.home()) => {
        selectWorkspace(id);
        /*
         * Home unless somewhere else is asked for.
         *
         * A page id from the previous workspace is not reachable in the new
         * one, and leaving it in the URL would show a not-found for a page that
         * exists. The Workspaces mode passes its own destination instead
         * (ADR-0070): choosing a workspace there is choosing what to configure,
         * so it stays in the section it was reading rather than walking out of
         * the area it was just used in.
         *
         * A destination that is already the address is not navigated to. The
         * list looks the same before and after — only the chooser under it
         * changed — and a history entry that changes nothing makes Back do
         * nothing.
         */
        if (to !== window.location.pathname) navigate(to);
        // The session response carries the workspace list, so a freshly created
        // workspace has to be picked up before it can be selected.
        void reload();
      }}
      onLogout={() => void logout()}
    />
  );
}

function Workspace({
  workspaceId,
  workspaceName,
  displayName,
  session,
  route,
  navigate,
  onSwitchWorkspace,
  onLogout,
}: {
  workspaceId: string;
  workspaceName: string;
  displayName: string;
  session: import('./api/client.ts').SessionInfo;
  route: ReturnType<typeof useRoute>['route'];
  /** With `replace`, for the redirect of an old settings URL (ADR-0032). */
  navigate: (to: string, options?: { replace?: boolean }) => void;
  /** Switch, and land where the caller says — home when it says nothing. */
  onSwitchWorkspace: (workspaceId: string, to?: string) => void;
  onLogout: () => void;
  /* Null while an old settings URL is being replaced: rendering the wrong area
     for one frame would flash a heading nobody asked for. */
}): ReactElement | null {
  // The workspace's own defaults, applied as custom properties on the document
  // root. Nothing else reads a theme: it changes what the existing variables
  // resolve to, and the stylesheet already falls back to its own answer where
  // one is absent (ADR-0023).
  useWorkspaceTheme(workspaceId);

  const message = useMessage();
  const { t } = useT();

  // Whether there is anything above the fold, for the line under the bar at the
  // top (ADR-0042).
  const { scrolled, ref: mainRef } = useScrolled();
  const { client, state: connectionState, failure } = useSoneClient({
    workspaceId,
    displayName,
    userId: session.user.id,
  });
  const {
    tree,
    pages,
    createPage,
    archivePage,
    renameEntry,
    moveEntry,
    applyTitle,
    reload: reloadPages,
    loading: pagesLoading,
    error: pagesError,
  } = usePages(workspaceId);
  // The entry a move dialog is open for, if any.
  const [movingId, setMovingId] = useState<string | null>(null);
  /** The entry being moved to another workspace (ADR-0038). */
  const [movingToWorkspaceId, setMovingToWorkspaceId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const {
    favourites,
    ids: favouriteIds,
    toggle: toggleFavourite,
  } = useFavourites(workspaceId);
  /*
   * Which pages are watched (ADR-0064).
   *
   * A separate hook from favourites, because they are separate acts — the star
   * and the bell sit beside each other and mean different things.
   */
  const { ids: watchedIds, toggle: toggleWatching } = useWatching(workspaceId);
  const {
    visible: sidebarVisible,
    isColumn,
    toggle: toggleSidebar,
    close: closeSidebar,
  } = useSidebar(route);

  /*
   * Which mode the shell is in (ADR-0069). The rail picks it, the panel
   * navigates within it, the area to the right shows what the panel selected.
   */
  const mode = modeOf(route.kind);
  const inbox = useInbox();
  const [inboxView, setInboxView] = useState<InboxView>({ of: 'unread' });
  const [trashEntries, setTrashEntries] = useState<TrashEntry[] | null>(null);
  const [trashView, setTrashView] = useState<TrashView>('recent');
  /*
   * What is being looked for in the trash (ADR-0071).
   *
   * Held here rather than in the panel, for the same reason the view is: the
   * menu counts what the list shows, and a query the panel kept to itself would
   * be a filter the counts did not know about.
   */
  const [trashQuery, setTrashQuery] = useState('');

  /*
   * Two menus, not one list with two headings (ADR-0072).
   *
   * ADR-0070 took the workspace out of the settings list, leaving you and the
   * server as two groups in one column. Two is still two subjects, and the
   * column was already long enough that "Wo du landest" and "Mailserver" sat
   * six rows apart in it — with more to come on both sides. So they are two
   * areas, which is what the account menu has been calling them all along.
   *
   * One group each, and no group heading: the panel's own title says which area
   * this is, and repeating it over the only group in the column would be the
   * heading saying nothing.
   */
  const settingsGroups: SectionGroup[] = [
    {
      sections: YOU_SECTIONS.map((e) => ({ id: e.id, label: t(e.label), hint: t(e.hint) })),
      hrefFor: (id) => paths.settings(id),
    },
  ];
  const adminGroups: SectionGroup[] = [
    {
      sections: ADMIN_SECTIONS.map((e) => ({ id: e.id, label: t(e.label), hint: t(e.hint) })),
      hrefFor: (id) => paths.admin(id),
    },
  ];
  const settingsCurrentHref =
    route.kind === 'admin'
      ? paths.admin(resolveSection(ADMIN_SECTIONS, route.section))
      : paths.settings(
          resolveSection(YOU_SECTIONS, route.kind === 'settings' ? route.section : ''),
        );

  /*
   * The workspace the Workspaces mode is talking about.
   *
   * The one in the address while a section is open — an administrator may be
   * configuring one they are not in — and otherwise the one you are in, which
   * is what the chooser should already be showing when you arrive at the list.
   */
  const chosenWorkspaceId =
    route.kind === 'workspaceSettings' ? (route.workspaceId ?? workspaceId) : workspaceId;
  const chosenWorkspaceName =
    session.workspaces.find((one) => one.id === chosenWorkspaceId)?.name ?? workspaceName;
  const workspaceCurrentHref =
    route.kind === 'workspaceSettings'
      ? paths.workspaceSettings(
          resolveSection(WORKSPACE_SECTIONS, route.section),
          chosenWorkspaceId,
        )
      : paths.workspaces();

  /*
   * Built once and given to exactly one place: the rail above the breakpoint,
   * the mode bar below it (ADR-0074). Two mounted copies would be two requests
   * for the same unread count and two answers that can disagree for a moment.
   */
  const accountMenu = (
    <AccountMenu
      displayName={session.user.displayName}
      // A word rather than a name below the breakpoint: the bar gives this a
      // fifth of a phone's width, where a name is an ellipsis (ADR-0074).
      label={isColumn ? undefined : t('mode.you')}
      userId={session.user.id}
      canAdminister={session.user.isInstanceAdmin || session.user.canManageWorkspaces}
      onLogout={onLogout}
    />
  );
  const [rightOpen, setRightOpen] = useState(readRightPanelOpen);

  // Remembered per browser: reopening the panel on every navigation is the kind
  // of small friction that makes an app feel inattentive.
  useEffect(() => {
    try {
      localStorage.setItem('sone.rightPanel', String(rightOpen));
    } catch {
      // Storage disabled; the panel simply starts closed next time.
    }
  }, [rightOpen]);

  const routePageId = route.kind === 'page' ? route.pageId : null;

  // A folder has no document, so no sync handle is opened for one. Looked up in
  // the tree rather than fetched: the tree already knows every entry's kind, and
  // a request to find out would delay the render for nothing.
  const selected = routePageId ? findNode(tree, routePageId) : null;
  const isFolder = selected?.kind === 'folder';
  const pageId = isFolder ? null : routePageId;
  const handle = usePage(client, pageId);
  /**
   * The page's comment threads (ADR-0046).
   *
   * Owned here rather than in the panel, because the editor needs the same list
   * to draw its marks: two readers of one document would disagree about the
   * moment a thread appeared, and a mark over the wrong words is the failure
   * this whole feature is built to avoid.
   */
  /*
   * And the internal ones, in their own document (ADR-0057).
   *
   * Opened through the same `usePage` with the suffixed id, because the store
   * keys entries by the string and passes it through unchanged — the channel
   * name, the open message and the persistence all take it as it is. So a
   * second document needed no client change at all, which I checked rather than
   * assumed.
   *
   * Only for a member: a share-link visitor is refused this room by the server,
   * and asking anyway would produce an error frame on every page they open.
   */
  /*
   * Whether this person could open the internal room at all.
   *
   * `isGuest` marks a share-link session, which the server refuses that room —
   * so asking anyway would produce an error frame on every page a guest opens,
   * and a console full of refusals is how somebody stops reading them.
   */
  const canSeeInternal = !session.user.isGuest;
  const internalId = canSeeInternal && pageId ? asInternalRequest(pageId) : null;
  const internalHandle = usePage(client, internalId);

  const comments = useComments(handle?.doc ?? null, session.user.id);
  const internalComments = useComments(internalHandle?.doc ?? null, session.user.id);
  /**
   * A selection somebody has pressed Comment on, before they have written
   * anything.
   *
   * Held rather than turned into a thread at once: a thread with an empty first
   * message is a highlight over nothing, and it would arrive on somebody else's
   * screen as exactly that.
   */
  const [pendingComment, setPendingComment] = useState<CommentAnchor | null>(null);
  /** How much a commented passage is marked, and whether at all here. */
  const marks = useCommentMarkStyle();
  /**
   * A past version being read (ADR-0047).
   *
   * Not in the URL. A version is something somebody is looking at for a moment,
   * and a link to one would promise that it still exists when opened — which
   * thinning does not guarantee, and which would make a stale link show a
   * different past than the one that was shared.
   */
  const [viewingVersion, setViewingVersion] = useState<string | null>(null);
  /** A version being compared rather than read (ADR-0053). */
  const [comparingVersion, setComparingVersion] = useState<string | null>(null);
  /** The entry somebody is exporting, if any (ADR-0044). */
  const [exportingId, setExportingId] = useState<string | null>(null);
  /** The entry somebody is importing into, if any (ADR-0044). */
  const [importingId, setImportingId] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  useEffect(() => {
    let cancelled = false;
    void api
      .members(workspaceId)
      .then((result) => {
        if (!cancelled) setMembers(result.members);
      })
      .catch(() => {
        // Names are a nicety: a comment still reads without one.
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  /*
   * Whether this workspace has already been arrived at (ADR-0072).
   *
   * "Where you land" answers two different questions with one setting, and the
   * difference only shows once the mark is a button somebody presses on
   * purpose. Arriving — a fresh load, a sign-in, a switch of workspace — means
   * the setting in full, including "the page I was last on". Pressing the mark
   * later cannot mean that: you are *on* that page, so the mark would do
   * nothing, which is how it read as broken.
   *
   * So a later press goes to the top of the tree instead. A fixed landing page
   * is honoured either way — somebody who named a page meant that page.
   */
  const arrived = useRef<string | null>(null);

  // The root redirects to a page rather than showing an empty shell.
  useEffect(() => {
    if (route.kind !== 'home') return;
    // Not while the tree is being fetched.
    //
    // Redirecting from a list that is still loading means redirecting to
    // whatever was there before — which after a workspace switch is a page in
    // the workspace just left, and the server refuses it. Correctly, and to
    // somebody who only pressed a switcher.
    if (pagesLoading) return;

    let cancelled = false;
    void api
      .landing(workspaceId)
      .then((landing) => {
        if (cancelled) return;
        // Where they were, or the page they chose — the server has already
        // checked it is still reachable, so this is a page or nothing.
        const first = pages[0]?.id ?? null;
        const again = arrived.current === workspaceId;
        arrived.current = workspaceId;
        const target =
          again && landing.mode !== 'fixed' ? first : (landing.landOn ?? first);
        if (!target) return;
        const node = pages.find((page) => page.id === target);
        navigate(paths.page(target, node?.title ?? ''));
      })
      .catch(() => {
        // The first page, as before. A landing preference that cannot be read
        // should cost somebody a good guess, not a blank screen.
        arrived.current = workspaceId;
        const first = pages[0];
        if (first) navigate(paths.page(first.id, first.title ?? undefined));
      });

    return () => {
      cancelled = true;
    };
  }, [route.kind, pages, pagesLoading, navigate, workspaceId]);

  // Remember where they are.
  //
  // On the page rather than on leaving it: a tab closed without warning is the
  // common way a session ends, and an unload handler is the least reliable
  // moment in a browser.
  useEffect(() => {
    if (!routePageId || isFolder) return;
    const timer = setTimeout(() => {
      void api.setLanding(workspaceId, { lastPageId: routePageId }).catch(() => {
        // Where somebody was is worth remembering and not worth reporting.
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [routePageId, isFolder, workspaceId]);

  const onCreateEntry = async (
    parentPageId: string | null,
    kind: 'page' | 'folder' | 'canvas',
    // A shape to start from, when one was chosen (ADR-0045).
    templateId?: string,
  ): Promise<void> => {
    const id = await createPage({
      title: '',
      parentPageId,
      kind,
      ...(templateId ? { templateId } : {}),
    });
    // A folder has no document to open, so creating one must not navigate
    // anywhere — it appears in the sidebar and the person carries on.
    //
    // A canvas does open, which it did not before: a page started from a
    // template is a page somebody wants to look at, and so is a board.
    if (id && kind !== 'folder') navigate(paths.page(id));
  };

  // Settings is its own screen, not a page inside the workspace.
  //
  // It was rendered in the content column, which put a sidebar of pages beside
  // a list of instance settings — two navigations for two unrelated things,
  // side by side, and neither of them the one somebody is using. This returns
  // early with a surface of its own and a way back (ADR-0027).
  /*
   * The one thing that still has to happen before the shell renders.
   *
   * An old section id, from a bookmark or an older build. Redirected rather
   * than answered with the first section of the wrong area (ADR-0032): URLs are
   * a public contract, and a link that lands somewhere plausible but wrong is
   * worse than one that lands somewhere right.
   */
  const moved = route.kind === 'settings' ? MOVED_SETTINGS[route.section] : undefined;
  if (moved) {
    navigate(moved, { replace: true });
    return null;
  }

  return (
    <div
      className="app with-sidebar"
      // Drives the grid: a column exists only when it is showing, so the
      // reading column is not narrowed for a panel nobody asked for and the
      // sidebar leaves no empty strip behind when hidden.
      data-right-panel={rightOpen ? 'open' : 'closed'}
      data-sidebar={sidebarVisible ? 'shown' : 'hidden'}
    >
      {/* First in the DOM as well as first in the grid. It is the outermost
          frame of the window, and a screen reader reading the shell in source
          order should meet the map before the tree. */}
      <IconRail here={mode} account={isColumn ? accountMenu : null} />

      <Sidebar
        mode={mode}
        panelTitle={
          mode === 'inbox'
            ? t('inbox.title')
            : mode === 'trash'
              ? t('trash.title')
              : mode === 'settings'
                ? t('settings.title')
                : mode === 'admin'
                  ? t('area.instance')
                  : t('workspaces.area')
        }
        panelScope={
          mode === 'trash'
            ? t('trash.scope', { workspace: workspaceName })
            : mode === 'settings'
              ? t('settings.scope')
              : mode === 'admin'
                ? // Said where the changes are made, because this is the one
                  // area where a setting is somebody else's problem too.
                  t('admin.scope')
                : undefined
        }
        /* The Workspaces mode says its scope with a control rather than a line:
           which workspace is not a fact to read here, it is the choice the rest
           of the column depends on (ADR-0070). */
        panelChooser={
          mode === 'workspaces' ? (
            <WorkspaceChooser
              chosenId={chosenWorkspaceId}
              chosenName={chosenWorkspaceName}
              chosenIcon={
                session.workspaces.find((one) => one.id === chosenWorkspaceId)?.icon ?? null
              }
              current={workspaceCurrentHref}
              onChoose={onSwitchWorkspace}
            />
          ) : undefined
        }
        panelAction={
          mode === 'inbox' && (inbox.items ?? []).some((one) => !one.read) ? (
            <button
              className="quiet panel-action"
              type="button"
              onClick={() => inbox.markRead()}
            >
              {t('inbox.markAll')}
            </button>
          ) : undefined
        }
        onStartExport={setExportingId}
        onStartImport={setImportingId}
        currentIcon={
          session.workspaces.find((w) => w.id === workspaceId)?.icon ?? null
        }
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        onSwitchWorkspace={onSwitchWorkspace}
        tree={tree}
        currentPageId={pageId}
        open={sidebarVisible}
        onClose={closeSidebar}
        onCreatePage={(parent, kind) => void onCreateEntry(parent, kind)}
        onRename={(id, title) => void renameEntry(id, title)}
        onStartMove={setMovingId}
        onStartMoveToWorkspace={setMovingToWorkspaceId}
        onStartShare={setSharingId}
        onMove={(id, parent, after) => void moveEntry(id, parent, after)}
        favourites={favourites}
        watchedIds={watchedIds}
        onToggleWatch={(pageId, watching) => void toggleWatching(pageId, watching)}
        favouriteIds={favouriteIds}
        onReloadTree={() => void reloadPages()}
        onToggleFavourite={(id, on) => void toggleFavourite(id, on)}
        onDelete={(id, descendants) => {
          // Confirmed, and the count is in the question. Trashing a folder
          // takes its contents, and someone who has not opened it in a month
          // may not remember what is inside.
          //
          // It says "to the trash" rather than "delete", which is what actually
          // happens: the entry is recoverable for thirty days (ADR-0027). A
          // question that overstates the consequence teaches people to distrust
          // the next one — and this one was also the last English string left in
          // a screen everything else in has been translated.
          const message =
            descendants > 0
              ? t('entry.confirmTrashWithChildren', { count: descendants })
              : t('entry.confirmTrash');
          if (!window.confirm(message)) return;
          void archivePage(id).then(() => {
            // Navigate away if the page being viewed was just deleted, or the
            // editor stays open on something that no longer exists.
            if (route.kind === 'page' && route.pageId === id) navigate(paths.home());
          });
        }}
      >
        {/* The menu, never the content (ADR-0069). Both are computed from the
            list the shell already holds, so the counts beside the names cost
            nothing and cannot disagree with what the list shows. */}
        {mode === 'inbox' && (
          <InboxPanel items={inbox.items} view={inboxView} onPick={setInboxView} />
        )}
        {mode === 'trash' && (
          <TrashPanel
            entries={trashEntries}
            view={trashView}
            query={trashQuery}
            onPick={setTrashView}
            onSearch={setTrashQuery}
          />
        )}
        {mode === 'settings' && (
          <SectionNav groups={settingsGroups} current={settingsCurrentHref} />
        )}
        {mode === 'admin' && (
          <SectionNav groups={adminGroups} current={settingsCurrentHref} />
        )}
        {mode === 'workspaces' && (
          <WorkspacePanel chosenId={chosenWorkspaceId} current={workspaceCurrentHref} />
        )}
      </Sidebar>

      {/* A failed tree operation used to vanish: usePages recorded the error
          and nothing rendered it, so a refused move looked like a move that
          did not save. Shown as a transient bar rather than a dialog — it is
          information, not a decision. */}
      {pagesError && (
        <div className="app-error" role="status">
          {message(pagesError)}
        </div>
      )}

      <div className="main" ref={mainRef} data-scrolled={scrolled ? 'true' : undefined}>
        <div className="topbar">
          {/* Always present, at every width. It used to be hidden above 800px
              on the theory that a permanent column needs no toggle — which left
              no way to reclaim the space, and no way to undo a collapse. */}
          <button
            className="quiet sidebar-toggle"
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarVisible ? 'Hide the sidebar' : 'Show the sidebar'}
            aria-expanded={sidebarVisible}
          >
            <SidebarIcon />
          </button>
          <PageStatus
            handle={handle}
            connectionState={connectionState}
            failure={failure}
          />
          <div className="topbar-end">
            <RightPanelToggle open={rightOpen} onToggle={() => setRightOpen((v) => !v)} />
          </div>
        </div>

        {/* Said where it cannot be missed rather than in Settings → About, which
            is the last place anybody looks. */}
        <StaleBundleNotice />
        {/* The requirement, during the grace period (ADR-0065).
          *
          * A banner and not a dialog: everything still works, and a modal for
          * something with a fortnight left is a modal people learn to dismiss
          * without reading. It is not dismissible either — it disappears when
          * the thing is done, which is the only honest way for it to go. */}
        {session.user.secondFactorStanding?.kind === 'grace' && (
          <p className="stale-bundle" role="status">
            {t('required.soon', {
              days: Math.max(
                1,
                Math.ceil(
                  (Date.parse(session.user.secondFactorStanding.deadline) - Date.now()) /
                    86_400_000,
                ),
              ),
            })}{' '}
            <a href={paths.settings('sign-in')}>{t('required.setUp')}</a>
          </p>
        )}

        {route.kind === 'page' && isFolder && selected && (
          <FolderView
            folder={selected}
            trail={ancestorNodes(tree, selected.id)}
            onCreate={(parent, kind) => void onCreateEntry(parent, kind)}
            onRename={(id, title) => void renameEntry(id, title)}
          />
        )}

        {route.kind === 'page' && !isFolder && handle && (
          <PageView
            /*
             * Where this page sits, but only while the sidebar is away
             * (ADR-0019's tree is the trail when it is there).
             *
             * A permanent breadcrumb would repeat what the sidebar already
             * shows, on every page, for the sake of the case where it does not.
             * With the sidebar hidden — on a phone, or by choice — a page gives
             * no clue where it is, which is worst for a collection's row: it
             * opens as a page with a name and no visible parent at all.
             */
            trail={sidebarVisible ? [] : ancestorNodes(tree, selected?.id ?? '')}
            // Already fetched for the comments panel: assigning a task needs
            // the same list, and fetching it again per menu opening would be a
            // request for something in hand (ADR-0052).
            members={members}
            connectionState={connectionState}
            handle={handle}
            pageId={routePageId!}
            threads={commentMarksFor(comments.threads)}
            // The threads themselves, for the canvas's marks: they carry the
            // item a thread is about, which the editor's drawn shape does not
            // (ADR-0057).
            itemThreads={comments.threads}
            internalItemThreads={canSeeInternal ? internalComments.threads : []}
            markStyle={marks.style}
            viewingVersion={viewingVersion}
            comparingVersion={comparingVersion}
            onCloseVersion={() => {
              setViewingVersion(null);
              setComparingVersion(null);
            }}
            onComment={(anchor) => {
              // Straight into a thread with an empty first message would be a
              // thread with nothing in it. So the anchor is held, the panel
              // opens, and the thread exists once somebody has actually said
              // something (ADR-0046).
              setPendingComment(anchor);
              setRightOpen(true);
            }}
            // Keeps the sidebar in step with the heading as it is typed. The
            // tree comes from the projection over HTTP, so without this it
            // showed the old name until something refetched.
            onTitleChange={(title) => applyTitle(routePageId!, title)}
          />
        )}

        {route.kind === 'page' && !isFolder && !handle && (
          <div className="page-body">
            <p className="muted">Opening…</p>
          </div>
        )}

        {route.kind === 'search' && (
          <SearchScreen workspaceId={workspaceId} initialQuery={route.query} />
        )}

        {route.kind === 'trash' && (
          <Trash
            workspaceId={workspaceId}
            view={trashView}
            query={trashQuery}
            entries={trashEntries}
            onEntries={setTrashEntries}
            tree={tree}
            onChanged={() => void reloadPages()}
          />
        )}

        {/* Per workspace, unlike the inbox below: a share is a rule about
            pages, and pages belong to one workspace. The question "what have I
            let out" is asked about a place, not about everything at once. */}
        {route.kind === 'shares' && <SharesScreen workspaceId={workspaceId} />}

        {/* The inbox spans workspaces, so it takes no workspace id — the whole
            point is being told about a question asked somewhere other than
            where somebody is standing (ADR-0052). */}
        {route.kind === 'settings' && (
          <Settings
            section={route.section}
            session={session}
            workspaceId={workspaceId}
            onClose={() => navigate(paths.home())}
            onLogout={onLogout}
          />
        )}

        {/* The list of workspaces, for everybody (ADR-0067). Outside the
            administration, because it was inside it — which is why a member had
            no list at all and could only edit the one they happened to be
            looking at. The server decides its length. */}
        {route.kind === 'workspaceList' && (
          <WorkspaceListScreen
            session={session}
            workspaceId={workspaceId}
            onClose={() => navigate(paths.home())}
            onLogout={onLogout}
          />
        )}

        {route.kind === 'workspaceSettings' && (
          <WorkspaceSettingsScreen
            section={route.section}
            session={session}
            // The one named in the address, or the one being looked at when the
            // address names none (ADR-0067).
            workspaceId={route.workspaceId ?? workspaceId}
            onClose={() => navigate(paths.home())}
            onLogout={onLogout}
          />
        )}

        {route.kind === 'admin' && (
          <AdminScreen
            section={route.section}
            session={session}
            workspaceId={workspaceId}
            onClose={() => navigate(paths.home())}
            onLogout={onLogout}
          />
        )}

        {route.kind === 'inbox' && (
          <InboxScreen
            /* Everything, and the view with it: the rows are conversations
               rather than notifications now, and grouping has to happen after
               filtering or a thread would be split across views (ADR-0071). */
            items={inbox.items}
            view={inboxView}
            error={inbox.error}
            onRead={inbox.setRead}
            onSnooze={inbox.snooze}
            onReply={inbox.reply}
          />
        )}

        {route.kind === 'home' && pages.length === 0 && (
          <div className="page-body">
            <h1>Nothing here yet</h1>
            <button
              className="primary"
              type="button"
              onClick={() => void onCreateEntry(null, 'page')}
            >
              Create your first page
            </button>
          </div>
        )}

        {route.kind === 'notFound' && (
          <div className="page-body">
            <h1>Not found</h1>
            <p className="muted">
              <a href={paths.home()}>Back to your pages</a>
            </p>
          </div>
        )}
      </div>

      {sharingId && (
        <ShareDialog
          workspaceId={workspaceId}
          pageId={sharingId}
          pageTitle={findNode(tree, sharingId)?.title ?? ''}
          // From the open document rather than fetched: the count is only
          // meaningful for the page somebody is looking at, which is the only
          // page this dialog is opened for.
          threadCount={sharingId === pageId ? comments.threads.length : 0}
          onClose={() => setSharingId(null)}
        />
      )}

      {movingToWorkspaceId && (
        <MoveToWorkspaceDialog
          entry={findNode(tree, movingToWorkspaceId)!}
          session={session}
          currentWorkspaceId={workspaceId}
          onCancel={() => setMovingToWorkspaceId(null)}
          onMoved={() => {
            setMovingToWorkspaceId(null);
            // The entry is not in this workspace any more, so the tree is
            // reloaded and — if it was the page being read — the way out is the
            // workspace's own landing page rather than a page that is elsewhere.
            if (pageId === movingToWorkspaceId) navigate(paths.home());
            void reloadPages();
          }}
        />
      )}

      {movingId && (
        <MoveDialog
          entry={findNode(tree, movingId)!}
          tree={tree}
          onCancel={() => setMovingId(null)}
          onMove={(parent) => {
            setMovingId(null);
            void moveEntry(movingId, parent);
          }}
        />
      )}

      {importingId && (
        <ImportDialog
          pageId={importingId}
          title={findNode(tree, importingId)?.title ?? ''}
          onClose={() => setImportingId(null)}
          // The pages exist and the sidebar does not know yet.
          onDone={() => void reloadPages()}
        />
      )}

      {exportingId && (
        <ExportDialog
          pageId={exportingId}
          title={findNode(tree, exportingId)?.title ?? ''}
          onClose={() => setExportingId(null)}
        />
      )}

      <RightSidebar
        handle={handle}
        pageId={pageId}
        workspaceId={workspaceId}
        open={rightOpen}
        onClose={() => setRightOpen(false)}
        comments={comments}
        internalComments={canSeeInternal ? internalComments : null}
        members={members}
        pendingComment={pendingComment}
        onCancelPendingComment={() => setPendingComment(null)}
        marks={marks}
        viewingVersion={viewingVersion}
        onViewVersion={(id) => {
          setViewingVersion(id);
          // Looking at a version and comparing it are two states, not one with a
          // mode: choosing either clears the other rather than leaving both set.
          setComparingVersion(null);
        }}
        onCompareVersion={(id) => {
          setComparingVersion(id);
          setViewingVersion(null);
        }}
        onRevealComment={(thread) => {
          // Resolving a thread's range into editor coordinates is the editor's
          // job, so revealing is a message to it rather than a scroll from
          // here. Nothing to do when the text is gone, and the button that
          // would ask is disabled in that case.
          if (thread.range) {
            window.dispatchEvent(
              new CustomEvent('sone:reveal-comment', { detail: thread.id }),
            );
          }
        }}
      />

      {/* Last in the DOM as well as last on screen (ADR-0074).
        *
        * The rail is first because it is the outermost frame of a window; the
        * bar is the same list of modes at the foot of a phone, and a screen
        * reader reading the shell in source order should meet it where the eye
        * does. Drawn only below 800px, by the stylesheet — the breakpoint has
        * one owner and it is the thing that draws it. */}
      <ModeBar here={mode} account={isColumn ? null : accountMenu} />
    </div>
  );
}

/**
 * A share link.
 *
 * The workspace is not known before authenticating, so the connection is
 * established with a placeholder and the real id arrives in the auth
 * acknowledgement. This is the one place the URL carries the credential
 * (ADR-0016), and it must work without any account at all.
 */
function ShareRoute({
  token,
  pageId,
}: {
  token: string;
  pageId: string | null;
}): ReactElement {
  /**
   * The name a visitor gave, remembered for this tab.
   *
   * Asking again on every reload is not a decision, it is an omission: nothing
   * about the name is worth re-deciding, and a page refresh is not a new visit.
   *
   * sessionStorage rather than localStorage, and per token. Per tab, because an
   * anonymous session already belongs to a tab — two tabs are two people as far
   * as presence is concerned, and sharing a name across them would make one
   * person appear twice under one label. Per token, because a different link is
   * a different context, possibly a different circle of people.
   *
   * It is a display name, not a credential, so it does not outlive the browser
   * session on what may be a shared machine.
   */
  const nameKey = `sone.share.name.${token}`;
  const remembered =
    typeof sessionStorage !== 'undefined' ? (sessionStorage.getItem(nameKey) ?? '') : '';

  const [displayName, setDisplayName] = useState(remembered);
  // Skipped entirely when a name is already known, so a reload lands back on
  // the page rather than on a form.
  const [joined, setJoined] = useState(remembered !== '');

  /**
   * Whether this link lets somebody write.
   *
   * The name is asked for so that other people can see who is editing — which
   * makes it pointless on a link that only reads. A reader was being stopped by
   * a form asking them to identify themselves before showing them a page they
   * were invited to read, which is a question with no purpose and, on a page
   * shared with strangers, one they may not want to answer.
   *
   * `null` while the answer is on its way: the form is not shown until it is
   * known, because showing it and then removing it is worse than a moment's
   * wait.
   */
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api
      .resolveShare(token)
      .then((info) => {
        // A password-protected link is resolved after the password, so its role
        // is not known yet — treated as writable, since asking for a name and
        // not needing it is a smaller fault than not asking and being unable to
        // attribute.
        if (!cancelled) setCanWrite(info.requiresPassword || info.role !== 'viewer');
      })
      .catch(() => {
        if (!cancelled) setCanWrite(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (canWrite === null && !joined) {
    return (
      <div className="centered">
        <p className="muted">{'…'}</p>
      </div>
    );
  }

  if (!joined && canWrite === true) {
    return (
      <div className="centered">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            const chosen = displayName.trim();
            try {
              if (chosen) sessionStorage.setItem(nameKey, chosen);
            } catch {
              // Private browsing, or storage that is full or disabled. The name
              // still works for this visit; it is simply asked for again next
              // time, which is what happened before this existed.
            }
            setJoined(true);
          }}
        >
          <h1>Shared page</h1>
          <p className="muted">
            Pick a name so other people can see who is editing. No account
            needed.
          </p>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Guest"
              autoFocus
            />
          </div>
          <button className="primary" type="submit">
            Open page
          </button>
        </form>
      </div>
    );
  }

  return (
    <ShareSession
      token={token}
      pageId={pageId}
      // Empty when nobody was asked, which is a reader — and an empty name
      // records nothing, so a reader leaves no trace in the people panel. That
      // is the correct outcome: they did not write anything to attribute.
      displayName={displayName}
    />
  );
}

/**
 * How deep an entry sits inside what was shared.
 *
 * Walked from the entry upwards rather than built as a tree, because the list
 * is small — it is one link's scope, not a workspace — and a flat list with an
 * indent reads the same and cannot lose a node whose parent is missing. Which
 * happens legitimately here: a restricted page inside the shared section is
 * withheld, and its children may not be.
 */
function depthOf(
  id: string,
  entries: ReadonlyArray<{ id: string; parentPageId: string | null }>,
): number {
  const byId = new Map(entries.map((one) => [one.id, one]));
  let depth = 0;
  let at = byId.get(id);
  // Bounded by the number of entries, so a cycle — which the database forbids
  // and this cannot verify — stops rather than hangs.
  while (at?.parentPageId && depth < entries.length) {
    at = byId.get(at.parentPageId);
    if (!at) break;
    depth += 1;
  }
  return depth;
}

/**
 * What the link opened on, for the head of the list.
 *
 * The entry with no parent *within what was shared* — which the route sets for
 * the scope page and for nothing else, so this is a lookup rather than a guess.
 * Empty string if the list has not arrived: the head is not a place to put
 * "loading".
 */
function sharedRootTitle(
  entries: ReadonlyArray<{ parentPageId: string | null; title: string }>,
): string {
  return entries.find((one) => one.parentPageId === null)?.title ?? '';
}

/** The kinds the entry icon draws, for a kind that arrives as text. */
function drawnKind(kind: string): 'page' | 'folder' | 'canvas' {
  return kind === 'folder' || kind === 'canvas' ? kind : 'page';
}

function ShareSession({
  token,
  pageId,
  displayName,
}: {
  token: string;
  pageId: string | null;
  displayName: string;
}): ReactElement {
  const { t } = useT();
  /*
   * Open to begin with, and closable — the same as the workspace.
   *
   * Not stored: `useSidebarWidth` keeps the workspace's choice in local
   * storage, and a link is a place somebody arrives once. Remembering that they
   * collapsed the list on a different link, weeks ago, would be a surprise
   * rather than a convenience.
   */
  const [treeOpen, setTreeOpen] = useState(true);
  /*
   * The right panel, closed to begin with.
   *
   * Not `readRightPanelOpen()`: that key is the workspace's, per browser, and a
   * member opening a link in their own browser would find the panel already
   * out — which is the workspace's setting leaking into a view that is not the
   * workspace. A link opens on the page.
   */
  const [rightOpen, setRightOpen] = useState(false);
  // The share token identifies the workspace server-side; the client does not
  // know it yet, so it sends a placeholder that the server ignores in favour of
  // the token's own workspace.
  const { client, state, fatal, passwordRequired, submitPassword } = useSoneClient({
    workspaceId: '00000000-0000-0000-0000-000000000000',
    shareToken: token,
    displayName,
  });
  /**
   * Resolve the token, always.
   *
   * Two jobs, and I first wrote this as though it had one. It supplies the page
   * for a link whose path has none — every link created before the page was
   * added to the URL — *and* it is what sets the share cookie, which is the
   * only credential this visitor has for ordinary HTTP requests.
   *
   * Skipping it when the path already carried a page therefore broke uploads
   * for exactly the links that were supposed to be better: no request, no
   * cookie, and every image upload refused. The page in the path is an
   * optimisation, not a reason to skip the handshake.
   */
  const [resolvedPageId, setResolvedPageId] = useState<string | null>(null);
  const [unresolvable, setUnresolvable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void api
      .resolveShare(token)
      .then((result) => {
        if (cancelled) return;
        // A password-protected link reports only that a password is needed; the
        // page arrives once the connection is unlocked, which the sync layer
        // handles.
        if (result.pageId) setResolvedPageId(result.pageId);
      })
      .catch(() => {
        // Only fatal when there is no page to fall back on. With one in the
        // path the document still opens; uploads will fail until the cookie is
        // in place, and that is better than refusing to show the page.
        if (!cancelled && pageId === null) setUnresolvable(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token, pageId]);

  const effectivePageId = pageId ?? resolvedPageId;
  const handle = usePage(client, effectivePageId);
  const [password, setPassword] = useState('');

  /**
   * What else the link reaches.
   *
   * Loaded because a shared **folder** was a shared nothing: this view renders
   * one page, a folder has no body, and there was no navigation here at all —
   * so a link to a section of the handbook arrived as an empty page with a
   * name at the top.
   *
   * Only what the link grants, asked of the server rather than filtered here:
   * a visitor holding a link is not a member and must not learn what else the
   * workspace contains.
   */
  const [shared, setShared] = useState<
    Array<{ id: string; parentPageId: string | null; title: string; kind: string; idx: string }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    void api
      .sharedPages(token)
      .then((result) => {
        if (!cancelled) setShared(result.pages);
      })
      // Quietly: a link to a single page has nothing to draw here, and a
      // password-protected one answers this only once it is unlocked.
      .catch(() => {
        if (!cancelled) setShared([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, passwordRequired]);

  if (passwordRequired) {
    return (
      <div className="centered">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            submitPassword(password);
          }}
        >
          <h1>This link is protected</h1>
          <div className="field">
            <label htmlFor="lp">Password</label>
            <input
              id="lp"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          <button className="primary" type="submit">
            Open
          </button>
        </form>
      </div>
    );
  }

  if (fatal || unresolvable) {
    return (
      <div className="centered">
        <div className="card">
          <h1>Link unavailable</h1>
          <p className="muted">
            This link may have been revoked or has expired.
          </p>
        </div>
      </div>
    );
  }

  /*
   * Only when the link reaches more than the page it names.
   *
   * A link to one page has nothing to navigate, and an aside holding a single
   * entry is furniture. This is the difference between sharing a page and
   * sharing a section, and the view should look like whichever one happened.
   */
  const hasTree = shared.length > 1;

  return (
    /*
     * The same shell as the workspace, minus the rail.
     *
     * `.app` is a grid of one column, so the first version's list became a
     * second *row* — a bar across the whole width, above the page. The column
     * has to be a track on the parent; `with-share-tree` is that track, and it
     * is conditional for the same reason the list is.
     *
     * No `with-sidebar`, so no rail column. The rail holds destinations —
     * inbox, trash, settings, the account — and a visitor holding a link has
     * none of them. A 56px strip of nothing beside the list would be the
     * workspace's furniture rendered for somebody who is not in the workspace.
     */
    <div
      className={hasTree ? 'app with-share-tree' : 'app'}
      data-sidebar={treeOpen ? 'shown' : 'hidden'}
      data-right-panel={rightOpen ? 'open' : 'closed'}
    >
      {hasTree && (
        <>
          {/* The overlay's backdrop, which only draws on a narrow screen. Same
              element and same class as the workspace's, so closing the drawer
              by tapping beside it works here without a second answer to what
              that gesture means. */}
          {treeOpen && (
            <button
              className="scrim"
              type="button"
              aria-label={t('sidebar.close')}
              onClick={() => setTreeOpen(false)}
            />
          )}
          <nav
            className={`sidebar share-tree${treeOpen ? ' open' : ''}`}
            aria-label={t('sidebar.label')}
            {...(treeOpen ? {} : { 'aria-hidden': true, inert: true })}
          >
            <div className="panel-head">
              <div className="sidebar-head">
                {/* What was shared, by name. The workspace puts its switcher
                    here; there is nothing to switch between on a link, so the
                    head says which section this is instead — which is the
                    question somebody opening a link actually has. */}
                <div className="panel-title">{sharedRootTitle(shared)}</div>
                <div className="sidebar-head-actions">
                  <button
                    className="quiet drawer-close"
                    type="button"
                    onClick={() => setTreeOpen(false)}
                    title={t('sidebar.hide')}
                    aria-label={t('sidebar.hide')}
                  >
                    <SidebarIcon />
                  </button>
                </div>
              </div>
            </div>

            <div className="panel-body">
              {shared.map((entry) => (
                <div
                  className="tree-row"
                  data-kind={entry.kind}
                  key={entry.id}
                  /* Depth as an indent on the row, from the flat list.
                   *
                   * The workspace nests its rows so a guide line can be drawn
                   * down a branch. Here the list cannot always be nested: a
                   * restricted page inside the shared section is withheld and
                   * its children are not, so a node whose parent is missing is
                   * a legitimate row — and building a tree would drop it. Same
                   * 18px step, so it reads the same. */
                  style={{
                    marginInlineStart: `${18 * depthOf(entry.id, shared)}px`,
                  }}
                >
                  <span className="tree-twisty" data-placeholder="true" aria-hidden="true" />
                  <a
                    className="tree-link"
                    draggable={false}
                    href={`/s/${encodeURIComponent(token)}/p/${entry.id}`}
                    {...(entry.id === effectivePageId
                      ? { 'aria-current': 'page' as const }
                      : {})}
                  >
                    <EntryIconView icon={null} kind={drawnKind(entry.kind)} />{' '}
                    <span>{entry.title}</span>
                  </a>
                </div>
              ))}
            </div>
          </nav>
        </>
      )}
      <div className="main">
        <div className="topbar">
          {/* The way back, and the reason the close button is safe to offer.
              Only when there is a list to reopen — on a single-page link this
              would toggle nothing. */}
          {hasTree && (
            <button
              className="quiet sidebar-toggle"
              type="button"
              onClick={() => setTreeOpen((open) => !open)}
              aria-label={treeOpen ? t('sidebar.hide') : t('sidebar.show')}
              aria-expanded={treeOpen}
            >
              <SidebarIcon />
            </button>
          )}
          <PageStatus handle={handle} connectionState={state} />
          <div className="topbar-end">
            <RightPanelToggle open={rightOpen} onToggle={() => setRightOpen((v) => !v)} />
          </div>
        </div>
        {handle && effectivePageId ? (
          <PageView
            handle={handle}
            pageId={effectivePageId}
            connectionState={state}
            // A guest sees the marks but has no panel here yet: the shared view
            // has no right sidebar, so a comment button would open nothing. The
            // guest's half of ADR-0046 is real and is the next slice.
            threads={[]}
            onComment={() => {}}
            // Nothing to mark: the shared view has no comments panel yet, and a
            // guest's half of ADR-0046 is the next slice.
            markStyle="off"
            // No trail here: this path renders a page outside the tree, so
            // there are no folders above it to name.
            trail={[]}
            // No member list on this path: it renders a page outside the
            // workspace shell, which is also why there is no trail. Assigning
            // needs the list, so the control is simply not offered here.
            members={[]}
            viewingVersion={null}
            comparingVersion={null}
            onCloseVersion={() => {}}
          />
        ) : (
          <div className="page-body">
            <p className="muted">Opening…</p>
          </div>
        )}
      </div>

      {/* The page's own panel, and only the page's own tabs.
        *
        * `PAGE_TABS`: the outline, the attachments, the pictures, the links
        * out. Not the version history, which names every author and every
        * moment they wrote; not the contributors; not the tasks and who they
        * are assigned to; not the discussion. Those describe the workspace,
        * and a link is not a way into the workspace.
        *
        * Not offered as a setting either. "Show the right sidebar" on a share
        * would either hand a stranger the history and the names, or be a
        * switch whose only power is to hide an outline. The split is a fact
        * about the tabs, so it lives with the tabs (see `PAGE_TABS`). */}
      <RightSidebar
        handle={handle}
        pageId={effectivePageId}
        // The workspace this page belongs to is not something a link tells the
        // client — the token names it server-side. None of `PAGE_TABS` needs
        // it, and passing a placeholder would be a lie the next tab believes.
        workspaceId=""
        open={rightOpen}
        onClose={() => setRightOpen(false)}
        tabs={PAGE_TABS}
      />
    </div>
  );
}

/**
 * What the editor needs to draw, from what the panel reads.
 *
 * The two want different shapes — the panel wants messages and quotations, the
 * editor wants two anchors and whether to draw at all — so the page converts
 * rather than either knowing about the other.
 */
function commentMarksFor(threads: CommentThread[]): DrawnThread[] {
  return threads.map((thread) => ({
    id: thread.id,
    from: thread.from,
    to: thread.to,
    resolved: thread.resolved,
  }));
}

/** Find a node anywhere in the tree. */
function findNode(nodes: PageNode[], pageId: string): PageNode | null {
  for (const node of nodes) {
    if (node.id === pageId) return node;
    const found = findNode(node.children, pageId);
    if (found) return found;
  }
  return null;
}

/** Ancestor nodes of an entry, outermost first, for a breadcrumb. */
function ancestorNodes(nodes: PageNode[], pageId: string): PageNode[] {
  const walk = (list: PageNode[], trail: PageNode[]): PageNode[] | null => {
    for (const node of list) {
      if (node.id === pageId) return trail;
      const found = walk(node.children, [...trail, node]);
      if (found) return found;
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}
