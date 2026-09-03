/**
 * SONE web — app root.
 *
 * Routing, session gating and layout. Deliberately the only place that knows
 * about all of those at once; everything else takes what it needs as props.
 */

import { useEffect, useState , type ReactElement } from 'react';

import { LoginScreen, SetupScreen, SignupScreen, useMessage } from './components/Auth.tsx';
import { FolderView } from './components/FolderView.tsx';
import { MoveDialog } from './components/MoveDialog.tsx';
import { MoveToWorkspaceDialog } from './components/MoveToWorkspaceDialog.tsx';
import { ShareDialog } from './components/ShareDialog.tsx';
import { Trash } from './components/Trash.tsx';
import { SidebarIcon } from './components/icons.tsx';
import { PageStatus, PageView } from './components/PageView.tsx';
import {
  RightPanelToggle,
  RightSidebar,
  readRightPanelOpen,
} from './components/RightSidebar.tsx';
import { SearchScreen } from './components/Search.tsx';
import { LocaleProvider, resolveLocale, useT } from './i18n/useT.tsx';
import { StaleBundleNotice } from './components/StaleBundleNotice.tsx';
import { AdminScreen } from './components/AdminScreen.tsx';
import { Settings } from './components/Settings.tsx';
import { WorkspaceSettingsScreen } from './components/WorkspaceSettingsScreen.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { usePage, useSoneClient } from './hooks/useSoneClient.ts';
import { useLinkInterception, useRoute } from './hooks/useRoute.ts';
import { usePages } from './hooks/usePages.ts';
import { useWorkspaceTheme } from './hooks/useWorkspaceTheme.ts';
import { useFavourites } from './hooks/useFavourites.ts';
import { useCommentMarkStyle } from './hooks/useCommentMarkStyle.ts';
import { ExportDialog } from './components/ExportDialog.tsx';
import { ImportDialog } from './components/ImportDialog.tsx';
import { InboxScreen } from './components/InboxScreen.tsx';
import { useComments } from './hooks/useComments.ts';
import { useScrolled } from './hooks/useScrolled.ts';
import { useSession } from './hooks/useSession.ts';
import { useSidebar } from './hooks/useSidebar.ts';
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
    return (
      <LoginScreen
        onDone={() => void reload()}
        navigate={navigate}
        instance={state.instance}
      />
    );
  }

  // --- authenticated ------------------------------------------------------

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
      onSwitchWorkspace={(id) => {
        selectWorkspace(id);
        // Back to the root: a page id from the previous workspace is not
        // reachable in the new one, and leaving it in the URL would show a
        // not-found for a page that exists.
        navigate(paths.home());
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
  onSwitchWorkspace: (workspaceId: string) => void;
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
  const {
    visible: sidebarVisible,
    toggle: toggleSidebar,
    close: closeSidebar,
  } = useSidebar(route);
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
  const comments = useComments(handle?.doc ?? null, session.user.id);
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

  // The root redirects to the first page rather than showing an empty shell.
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
        const target = landing.landOn ?? pages[0]?.id ?? null;
        if (!target) return;
        const node = pages.find((page) => page.id === target);
        navigate(paths.page(target, node?.title ?? ''));
      })
      .catch(() => {
        // The first page, as before. A landing preference that cannot be read
        // should cost somebody a good guess, not a blank screen.
        const first = pages[0];
        if (first) navigate(paths.page(first.id, first.title));
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
  if (route.kind === 'settings') {
    // An old section id, from a bookmark or an older build of this interface.
    // Redirected rather than answered with the first section of the wrong area
    // (ADR-0032): URLs are a public contract, and a link that lands somewhere
    // plausible but wrong is worse than one that lands somewhere right.
    const moved = MOVED_SETTINGS[route.section];
    if (moved) {
      navigate(moved, { replace: true });
      return null;
    }
    return (
      <Settings
        section={route.section}
        session={session}
        workspaceId={workspaceId}
        onClose={() => navigate(paths.home())}
        onLogout={onLogout}
      />
    );
  }

  if (route.kind === 'workspaceSettings') {
    return (
      <WorkspaceSettingsScreen
        section={route.section}
        session={session}
        workspaceId={workspaceId}
        onClose={() => navigate(paths.home())}
        onLogout={onLogout}
      />
    );
  }

  if (route.kind === 'admin') {
    return (
      <AdminScreen
        section={route.section}
        session={session}
        workspaceId={workspaceId}
        onClose={() => navigate(paths.home())}
        onLogout={onLogout}
      />
    );
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
      <Sidebar
        onStartExport={setExportingId}
        onStartImport={setImportingId}
        canManageWorkspaces={session.user.canManageWorkspaces}
        isInstanceAdmin={session.user.isInstanceAdmin}
        currentIcon={
          session.workspaces.find((w) => w.id === workspaceId)?.icon ?? null
        }
        displayName={session.user.displayName}
        userId={session.user.id}
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
        onLogout={onLogout}
      />

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
          <Trash workspaceId={workspaceId} onChanged={() => void reloadPages()} />
        )}

        {/* The inbox spans workspaces, so it takes no workspace id — the whole
            point is being told about a question asked somewhere other than
            where somebody is standing (ADR-0052). */}
        {route.kind === 'inbox' && <InboxScreen />}

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

function ShareSession({
  token,
  pageId,
  displayName,
}: {
  token: string;
  pageId: string | null;
  displayName: string;
}): ReactElement {
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

  return (
    <div className="app">
      {/* The shared-link view: no toggles and nothing to scroll past, so it
          keeps the plain bar. */}
      <div className="main">
        <div className="topbar">
          <PageStatus handle={handle} connectionState={state} />
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
